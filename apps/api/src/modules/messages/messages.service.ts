import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { AudienceService, Audience } from './audience.service';
import { sanitizeMessageHtml, textToMessageHtml } from './message-body';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import * as path from 'path';
import * as fs from 'fs';
import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';

const MIN_SCHEDULE_LEAD_MS = 60_000;

export interface SendActor {
  userId: string;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private emailService: EmailService,
    private audienceService: AudienceService,
  ) {}

  // --- Admin methods ---

  async findAllForCoop(coopId: string, page: number = 1) {
    const take = 20;
    const skip = (page - 1) * take;
    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { coopId },
        // Drafts and scheduled first, then most recently updated.
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        skip,
        take,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, format: true, createdAt: true, senderType: true },
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
    const withCounts = await Promise.all(
      conversations.map(async (c) => ({
        ...c,
        recipientCount:
          c.status === 'SENT'
            ? c._count.participants
            : (await this.audienceService.resolve(coopId, this.audienceOf(c))).shareholderIds.length,
      })),
    );
    return { conversations: withCounts, total, page, totalPages: Math.ceil(total / take) };
  }

  private audienceOf(c: {
    audienceType: 'ALL' | 'PROJECT' | 'SELECTED';
    audienceProjectId: string | null;
    audienceShareholderIds: string[];
  }): Audience {
    return { type: c.audienceType, projectId: c.audienceProjectId, shareholderIds: c.audienceShareholderIds };
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
    origin?: { apiKeyId?: string },
  ) {
    if (dto.type === 'DIRECT' && !dto.shareholderId) {
      throw new BadRequestException('shareholderId is required for DIRECT conversations');
    }
    const format = dto.format ?? 'HTML';
    const body = format === 'HTML' ? sanitizeMessageHtml(dto.body) : dto.body;
    if (!body) throw new BadRequestException('Message body is empty');

    const audience: Audience =
      dto.type === 'DIRECT'
        ? { type: 'SELECTED', shareholderIds: [dto.shareholderId!] }
        : (dto.audience ?? { type: 'ALL' });
    if (audience.type === 'PROJECT' && !audience.projectId) {
      throw new BadRequestException('projectId is required for a PROJECT audience');
    }

    const conversation = await this.prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          coopId,
          subject: dto.subject,
          type: dto.type,
          createdById: userId,
          status: 'DRAFT',
          audienceType: audience.type,
          audienceProjectId: audience.type === 'PROJECT' ? audience.projectId! : null,
          audienceShareholderIds: audience.type === 'SELECTED' ? (audience.shareholderIds ?? []) : [],
          createdByApiKeyId: origin?.apiKeyId ?? null,
        },
      });

      const message = await tx.message.create({
        data: { conversationId: conv.id, senderType: 'ADMIN', senderId: userId, body, format },
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
      return conv;
    });

    await this.auditService.log({
      coopId,
      entity: 'Conversation',
      entityId: conversation.id,
      action: 'CREATE',
      changes: [
        { field: 'type', oldValue: null, newValue: dto.type },
        { field: 'status', oldValue: null, newValue: dto.status ?? 'SENT' },
        ...(origin?.apiKeyId ? [{ field: 'apiKeyId', oldValue: null, newValue: origin.apiKeyId }] : []),
      ],
      actorId: userId,
      ipAddress: ip,
      userAgent,
    });

    if ((dto.status ?? 'SENT') === 'SENT') {
      await this.send(conversation.id, coopId, { userId, ip, userAgent });
    }
    return conversation;
  }

  private async loadForAdmin(conversationId: string, coopId: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.coopId !== coopId) throw new NotFoundException('Conversation not found');
    return conv;
  }

  async countRecipients(conversationId: string, coopId: string): Promise<number> {
    const conv = await this.loadForAdmin(conversationId, coopId);
    if (conv.status === 'SENT') {
      return this.prisma.conversationParticipant.count({ where: { conversationId } });
    }
    return (await this.audienceService.resolve(coopId, this.audienceOf(conv))).shareholderIds.length;
  }

  async updateDraft(conversationId: string, coopId: string, dto: UpdateDraftDto, userId: string) {
    const conv = await this.loadForAdmin(conversationId, coopId);
    if (conv.status !== 'DRAFT') throw new ConflictException('Conversation is not a draft');

    if (dto.body !== undefined || dto.format !== undefined) {
      const first = await this.prisma.message.findFirst({
        where: { conversationId, senderType: 'ADMIN' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, body: true, format: true },
      });
      if (!first) throw new NotFoundException('Draft message not found');
      const format = dto.format ?? 'HTML';
      let body: string;
      if (dto.body !== undefined) {
        body = format === 'HTML' ? sanitizeMessageHtml(dto.body) : dto.body;
      } else if (format === 'HTML' && first.format !== 'HTML') {
        // Format-only change turning an existing TEXT body into HTML: sanitise it once, on the way in.
        body = sanitizeMessageHtml(first.body);
      } else {
        // Format-only change (or no change): keep the existing body as-is.
        body = first.body;
      }
      if (!body) throw new BadRequestException('Message body is empty');
      await this.prisma.message.update({ where: { id: first.id }, data: { body, format } });
    }

    const data: Record<string, unknown> = {};
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.audience) {
      if (dto.audience.type === 'PROJECT' && !dto.audience.projectId) {
        throw new BadRequestException('projectId is required for a PROJECT audience');
      }
      data.audienceType = dto.audience.type;
      data.audienceProjectId = dto.audience.type === 'PROJECT' ? dto.audience.projectId : null;
      data.audienceShareholderIds = dto.audience.type === 'SELECTED' ? (dto.audience.shareholderIds ?? []) : [];
    }
    data.updatedAt = new Date();
    const updated = await this.prisma.conversation.update({ where: { id: conversationId }, data });

    await this.auditService.log({
      coopId,
      entity: 'Conversation',
      entityId: conversationId,
      action: 'UPDATE',
      changes: [{ field: 'draft', oldValue: null, newValue: 'edited' }],
      actorId: userId,
    });
    return updated;
  }

  async deleteDraft(conversationId: string, coopId: string, userId: string) {
    const conv = await this.loadForAdmin(conversationId, coopId);
    if (conv.status !== 'DRAFT') throw new ConflictException('Conversation is not a draft');
    await this.prisma.conversation.delete({ where: { id: conversationId } });
    await this.auditService.log({
      coopId,
      entity: 'Conversation',
      entityId: conversationId,
      action: 'DELETE',
      changes: [{ field: 'status', oldValue: 'DRAFT', newValue: null }],
      actorId: userId,
    });
  }

  /**
   * The only path that creates participants and queues shareholder e-mail.
   * Guarded by an updateMany on status so two concurrent calls cannot both send.
   */
  async send(conversationId: string, coopId: string, actor: SendActor) {
    const conv = await this.loadForAdmin(conversationId, coopId);
    if (conv.status === 'SENT') throw new ConflictException('Conversation already sent');

    const { shareholderIds } = await this.audienceService.resolve(coopId, this.audienceOf(conv));
    if (shareholderIds.length === 0) {
      throw new BadRequestException({ code: 'EMPTY_AUDIENCE', message: 'No recipients' });
    }

    const now = new Date();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const r = await tx.conversation.updateMany({
        where: { id: conversationId, status: { in: ['DRAFT', 'SCHEDULED'] } },
        data: { status: 'SENT', sentAt: now, scheduledAt: null, updatedAt: now },
      });
      if (r.count === 0) return false;
      await tx.conversationParticipant.createMany({
        data: shareholderIds.map((shareholderId) => ({ conversationId, shareholderId })),
        skipDuplicates: true,
      });
      return true;
    });
    if (!claimed) throw new ConflictException('Conversation already sent');

    await this.notifyParticipants(conversationId, coopId);

    await this.auditService.log({
      coopId,
      entity: 'Conversation',
      entityId: conversationId,
      action: 'UPDATE',
      changes: [
        { field: 'status', oldValue: conv.status, newValue: 'SENT' },
        { field: 'recipients', oldValue: null, newValue: shareholderIds.length },
      ],
      actorId: actor.userId,
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return { id: conversationId, status: 'SENT' as const, sentAt: now, recipientCount: shareholderIds.length };
  }

  async schedule(conversationId: string, coopId: string, scheduledAt: Date, userId: string) {
    const conv = await this.loadForAdmin(conversationId, coopId);
    if (conv.status !== 'DRAFT') throw new ConflictException('Conversation is not a draft');
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() - Date.now() < MIN_SCHEDULE_LEAD_MS) {
      throw new BadRequestException('scheduledAt must be at least one minute in the future');
    }
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'SCHEDULED', scheduledAt, sendAttempts: 0 },
    });
    await this.auditService.log({
      coopId,
      entity: 'Conversation',
      entityId: conversationId,
      action: 'UPDATE',
      changes: [
        { field: 'status', oldValue: 'DRAFT', newValue: 'SCHEDULED' },
        { field: 'scheduledAt', oldValue: null, newValue: scheduledAt.toISOString() },
      ],
      actorId: userId,
    });
    return updated;
  }

  async cancelSchedule(conversationId: string, coopId: string, userId: string) {
    const conv = await this.loadForAdmin(conversationId, coopId);
    if (conv.status !== 'SCHEDULED') throw new ConflictException('Conversation is not scheduled');
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'DRAFT', scheduledAt: null },
    });
    await this.auditService.log({
      coopId,
      entity: 'Conversation',
      entityId: conversationId,
      action: 'UPDATE',
      changes: [{ field: 'status', oldValue: 'SCHEDULED', newValue: 'DRAFT' }],
      actorId: userId,
    });
    return updated;
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
          body: sanitizeMessageHtml(dto.body),
          format: 'HTML',
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
          format: 'TEXT',
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
        format: 'TEXT',
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
        messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { attachments: { select: { id: true } } } },
      },
    });
    if (!conversation) return;

    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: { name: true, slug: true, emailEnabled: true },
    });
    if (!coop?.emailEnabled) return;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://opencoop.be';
    const last = conversation.messages[0];
    const messageBody = !last ? '' : last.format === 'HTML' ? last.body : textToMessageHtml(last.body);
    const hasAttachments = (last?.attachments?.length ?? 0) > 0;

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
          messageBody,
          hasAttachments,
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
