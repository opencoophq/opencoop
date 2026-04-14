import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import * as path from 'path';
import * as fs from 'fs';
import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private emailService: EmailService,
  ) {}

  // --- Admin methods ---

  async findAllForCoop(coopId: string, page: number = 1) {
    const take = 20;
    const skip = (page - 1) * take;
    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { coopId },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, createdAt: true, senderType: true },
          },
          participants: {
            take: 3,
            include: {
              shareholder: {
                select: { firstName: true, lastName: true, companyName: true, type: true },
              },
            },
          },
          _count: { select: { participants: true, messages: true } },
        },
      }),
      this.prisma.conversation.count({ where: { coopId } }),
    ]);
    return { conversations, total, page, totalPages: Math.ceil(total / take) };
  }

  async findByIdForAdmin(conversationId: string, coopId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { attachments: true },
        },
        participants: {
          include: {
            shareholder: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                companyName: true,
                email: true,
                type: true,
              },
            },
          },
        },
        _count: { select: { participants: true } },
      },
    });
    if (!conversation || conversation.coopId !== coopId) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  async createConversation(
    coopId: string,
    dto: CreateConversationDto,
    userId: string,
    ip?: string,
    userAgent?: string,
  ) {
    if (dto.type === 'DIRECT' && !dto.shareholderId) {
      throw new BadRequestException('shareholderId is required for DIRECT conversations');
    }

    const conversation = await this.prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          coopId,
          subject: dto.subject,
          type: dto.type,
          createdById: userId,
        },
      });

      const message = await tx.message.create({
        data: {
          conversationId: conv.id,
          senderType: 'ADMIN',
          senderId: userId,
          body: dto.body,
        },
      });

      if (dto.existingDocumentIds?.length) {
        await tx.messageAttachment.createMany({
          data: dto.existingDocumentIds.map((docId) => ({
            messageId: message.id,
            type: 'EXISTING_DOCUMENT',
            shareholderDocumentId: docId,
            fileName: '',
          })),
        });
      }

      if (dto.type === 'BROADCAST') {
        const shareholders = await tx.shareholder.findMany({
          where: { coopId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (shareholders.length > 0) {
          await tx.conversationParticipant.createMany({
            data: shareholders.map((s) => ({
              conversationId: conv.id,
              shareholderId: s.id,
            })),
          });
        }
      } else {
        await tx.conversationParticipant.create({
          data: {
            conversationId: conv.id,
            shareholderId: dto.shareholderId!,
          },
        });
      }

      return conv;
    });

    // Queue email notifications outside transaction
    await this.notifyParticipants(conversation.id, coopId);

    await this.auditService.log({
      coopId,
      entity: 'Conversation',
      entityId: conversation.id,
      action: 'CREATE',
      changes: [{ field: 'type', oldValue: null, newValue: dto.type }],
      actorId: userId,
      ipAddress: ip,
      userAgent,
    });

    return conversation;
  }

  async addAdminReply(
    conversationId: string,
    coopId: string,
    dto: CreateMessageDto,
    userId: string,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation || conversation.coopId !== coopId) {
      throw new NotFoundException('Conversation not found');
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          conversationId,
          senderType: 'ADMIN',
          senderId: userId,
          body: dto.body,
        },
      });

      if (dto.existingDocumentIds?.length) {
        await tx.messageAttachment.createMany({
          data: dto.existingDocumentIds.map((docId) => ({
            messageId: msg.id,
            type: 'EXISTING_DOCUMENT',
            shareholderDocumentId: docId,
            fileName: '',
          })),
        });
      }

      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      return msg;
    });

    await this.notifyParticipants(conversationId, coopId);

    return message;
  }

  // --- Shareholder methods ---

  async findAllForShareholder(shareholderId: string) {
    const participations = await this.prisma.conversationParticipant.findMany({
      where: { shareholderId },
      orderBy: { conversation: { updatedAt: 'desc' } },
      include: {
        conversation: {
          include: {
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { body: true, createdAt: true, senderType: true },
            },
          },
        },
      },
    });

    return participations.map((p) => ({
      ...p.conversation,
      readAt: p.readAt,
      isUnread: !p.readAt || p.readAt < p.conversation.updatedAt,
    }));
  }

  async findByIdForShareholder(conversationId: string, shareholderId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: {
        conversationId_shareholderId: { conversationId, shareholderId },
      },
      include: {
        conversation: {
          include: {
            messages: {
              orderBy: { createdAt: 'asc' },
              include: { attachments: true },
            },
          },
        },
      },
    });
    if (!participant) {
      throw new NotFoundException('Conversation not found');
    }

    // Mark as read
    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { readAt: new Date() },
    });

    return participant.conversation;
  }

  async createShareholderConversation(
    shareholderId: string,
    coopId: string,
    subject: string,
    body: string,
    userId: string,
  ) {
    const conversation = await this.prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          coopId,
          subject,
          type: 'DIRECT',
          createdById: userId,
        },
      });

      await tx.message.create({
        data: {
          conversationId: conv.id,
          senderType: 'SHAREHOLDER',
          senderId: shareholderId,
          body,
        },
      });

      await tx.conversationParticipant.create({
        data: {
          conversationId: conv.id,
          shareholderId,
          readAt: new Date(),
        },
      });

      return conv;
    });

    await this.notifyAdmins(conversation.id, coopId);

    return conversation;
  }

  async addShareholderReply(conversationId: string, shareholderId: string, body: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: {
        conversationId_shareholderId: { conversationId, shareholderId },
      },
    });
    if (!participant) {
      throw new NotFoundException('Conversation not found');
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderType: 'SHAREHOLDER',
        senderId: shareholderId,
        body,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { readAt: new Date() },
    });

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (conversation) {
      await this.notifyAdmins(conversationId, conversation.coopId);
    }

    return message;
  }

  async getUnreadCount(shareholderId: string): Promise<number> {
    const participations = await this.prisma.conversationParticipant.findMany({
      where: { shareholderId },
      include: { conversation: { select: { updatedAt: true } } },
    });
    return participations.filter(
      (p) => !p.readAt || p.readAt < p.conversation.updatedAt,
    ).length;
  }

  // --- File attachments ---

  async addUploadedAttachment(
    conversationId: string,
    coopId: string,
    messageId: string,
    file: Express.Multer.File,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation || conversation.coopId !== coopId) {
      throw new NotFoundException('Conversation not found');
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundException('Message not found');
    }

    const uploadDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'messages');
    await fs.promises.mkdir(uploadDir, { recursive: true });
    const filename = `${Date.now()}-${path.basename(file.originalname)}`;
    const filePath = path.join(uploadDir, filename);
    await fs.promises.writeFile(filePath, file.buffer);

    const attachment = await this.prisma.messageAttachment.create({
      data: {
        messageId,
        type: 'UPLOADED_FILE',
        filePath: `messages/${filename}`,
        fileName: file.originalname,
        mimeType: file.mimetype,
      },
    });

    // Create ShareholderDocument for each participant so attachments appear in Documents
    if (conversation.type === 'BROADCAST') {
      const participants = await this.prisma.conversationParticipant.findMany({
        where: { conversationId },
        select: { shareholderId: true },
      });
      if (participants.length > 0) {
        await this.prisma.shareholderDocument.createMany({
          data: participants.map((p) => ({
            shareholderId: p.shareholderId,
            type: 'CORRESPONDENCE' as const,
            filePath: `messages/${filename}`,
            generatedAt: new Date(),
          })),
        });
      }
    } else {
      const participant = await this.prisma.conversationParticipant.findFirst({
        where: { conversationId },
      });
      if (participant) {
        await this.prisma.shareholderDocument.create({
          data: {
            shareholderId: participant.shareholderId,
            type: 'CORRESPONDENCE',
            filePath: `messages/${filename}`,
            generatedAt: new Date(),
          },
        });
      }
    }

    return attachment;
  }

  // --- Email notifications ---

  private async notifyParticipants(conversationId: string, coopId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          include: {
            shareholder: {
              select: {
                email: true,
                firstName: true,
                user: { select: { preferredLanguage: true, email: true } },
              },
            },
          },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!conversation) return;

    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: { name: true, slug: true, emailEnabled: true },
    });
    if (!coop?.emailEnabled) return;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://opencoop.be';
    const rawBody = conversation.messages[0]?.body || '';
    const messagePreview = rawBody.length > 150 ? rawBody.slice(0, 150) + '...' : rawBody;

    for (const participant of conversation.participants) {
      const resolvedEmail = resolveShareholderEmail(participant.shareholder);
      if (!resolvedEmail) continue;
      const language = participant.shareholder.user?.preferredLanguage || 'nl';
      await this.emailService.send({
        coopId,
        to: resolvedEmail,
        subject: `${coop.name}: ${conversation.subject}`,
        templateKey: 'message-notification',
        templateData: {
          coopName: coop.name,
          shareholderName: participant.shareholder.firstName || '',
          messageSubject: conversation.subject,
          messagePreview,
          inboxUrl: `${appUrl}/${language}/dashboard/inbox/${conversationId}`,
          language,
        },
      });
    }
  }

  private async notifyAdmins(conversationId: string, coopId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!conversation) return;

    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: { name: true, emailEnabled: true },
    });
    if (!coop?.emailEnabled) return;

    const admins = await this.prisma.coopAdmin.findMany({
      where: { coopId },
      include: { user: { select: { email: true, name: true } } },
    });

    for (const admin of admins) {
      await this.emailService.send({
        coopId,
        to: admin.user.email,
        subject: `${coop.name}: Nieuw bericht - ${conversation.subject}`,
        templateKey: 'admin-message-notification',
        templateData: {
          coopName: coop.name,
          adminName: admin.user.name || '',
          messageSubject: conversation.subject,
          messagePreview: conversation.messages[0]?.body.slice(0, 150) || '',
        },
      });
    }
  }
}
