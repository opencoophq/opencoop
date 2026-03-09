# Messaging / Inbox Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a bank-style messaging inbox where coops can send broadcasts or direct messages to shareholders (with document attachments), shareholders can start conversations and reply, and email notifications are sent.

**Architecture:** Conversation-based threading with `Conversation`, `ConversationParticipant`, `Message`, and `MessageAttachment` models. Admin endpoints on the existing `AdminController`, shareholder endpoints on `ShareholderActionsController`. Email notifications via existing Bull queue. Document attachments also appear in shareholder's Documents page.

**Tech Stack:** Prisma (schema), NestJS (API modules/controllers/services), Next.js App Router (frontend pages), Bull/Redis (email queue), next-intl (i18n)

---

### Task 1: Database Schema — Models & Enums

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Step 1: Add enum and models to schema**

Add after the `EmailLog` model (after line 696):

```prisma
// ============================================================================
// MESSAGING
// ============================================================================

enum ConversationType {
  BROADCAST
  DIRECT
}

model Conversation {
  id        String           @id @default(cuid())
  coopId    String
  subject   String
  type      ConversationType
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt

  createdById String // userId of whoever started it

  coop         Coop                      @relation(fields: [coopId], references: [id], onDelete: Cascade)
  createdBy    User                      @relation("ConversationCreatedBy", fields: [createdById], references: [id])
  messages     Message[]
  participants ConversationParticipant[]

  @@index([coopId])
  @@index([createdById])
  @@map("conversations")
}

model ConversationParticipant {
  id             String    @id @default(cuid())
  conversationId String
  shareholderId  String
  readAt         DateTime?
  createdAt      DateTime  @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  shareholder  Shareholder  @relation(fields: [shareholderId], references: [id], onDelete: Cascade)

  @@unique([conversationId, shareholderId])
  @@index([shareholderId])
  @@map("conversation_participants")
}

model Message {
  id             String   @id @default(cuid())
  conversationId String
  senderType     String   // "ADMIN" | "SHAREHOLDER"
  senderId       String   // userId (for admin) or shareholderId (for shareholder)
  body           String
  createdAt      DateTime @default(now())

  conversation Conversation       @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  attachments  MessageAttachment[]

  @@index([conversationId])
  @@map("messages")
}

model MessageAttachment {
  id        String  @id @default(cuid())
  messageId String
  type      String  // "UPLOADED_FILE" | "EXISTING_DOCUMENT"
  filePath  String? // for uploads
  fileName  String
  mimeType  String?

  // Link to existing ShareholderDocument (when type = EXISTING_DOCUMENT)
  shareholderDocumentId String?

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@map("message_attachments")
}
```

**Step 2: Add CORRESPONDENCE to DocumentType enum**

Find the `DocumentType` enum (line 63) and add:

```prisma
enum DocumentType {
  SHARE_CERTIFICATE
  PURCHASE_STATEMENT
  DIVIDEND_STATEMENT
  TRANSACTION_REPORT
  CORRESPONDENCE
}
```

**Step 3: Add relations to Coop, Shareholder, and User models**

Add to `Coop` model relations (after line 152, before `@@map`):
```prisma
  conversations    Conversation[]
```

Add to `Shareholder` model relations (after `claimedGifts` relation):
```prisma
  conversationParticipants ConversationParticipant[]
```

Add to `User` model relations (find the User model):
```prisma
  conversationsCreated Conversation[] @relation("ConversationCreatedBy")
```

**Step 4: Generate Prisma client and push schema**

```bash
pnpm db:generate
pnpm db:push
```

**Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit -m "feat(messaging): add Conversation, Message, and Attachment schema models"
```

---

### Task 2: Backend — Messages Module & Service

**Files:**
- Create: `apps/api/src/modules/messages/messages.module.ts`
- Create: `apps/api/src/modules/messages/messages.service.ts`
- Create: `apps/api/src/modules/messages/dto/create-conversation.dto.ts`
- Create: `apps/api/src/modules/messages/dto/create-message.dto.ts`

**Step 1: Create DTOs**

`create-conversation.dto.ts`:
```typescript
import { IsString, IsOptional, IsEnum, MinLength, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateConversationDto {
  @ApiProperty({ example: 'Uitnodiging Algemene Vergadering 2026' })
  @IsString()
  @MinLength(1)
  subject: string;

  @ApiProperty({ enum: ['BROADCAST', 'DIRECT'], example: 'BROADCAST' })
  @IsEnum(['BROADCAST', 'DIRECT'] as const)
  type: 'BROADCAST' | 'DIRECT';

  @ApiProperty({ example: 'Beste leden, ...' })
  @IsString()
  @MinLength(1)
  body: string;

  @ApiProperty({ required: false, description: 'Required for DIRECT type' })
  @IsOptional()
  @IsString()
  shareholderId?: string;

  @ApiProperty({ required: false, description: 'IDs of existing ShareholderDocuments to attach' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  existingDocumentIds?: string[];
}
```

`create-message.dto.ts`:
```typescript
import { IsString, IsOptional, IsArray, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateMessageDto {
  @ApiProperty({ example: 'Bedankt voor uw vraag. ...' })
  @IsString()
  @MinLength(1)
  body: string;

  @ApiProperty({ required: false, description: 'IDs of existing ShareholderDocuments to attach' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  existingDocumentIds?: string[];
}
```

**Step 2: Create service**

`messages.service.ts`:
```typescript
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { DocumentsService } from '../documents/documents.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private emailService: EmailService,
  ) {}

  // === Admin methods ===

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
          include: {
            attachments: true,
          },
        },
        participants: {
          include: {
            shareholder: {
              select: { id: true, firstName: true, lastName: true, companyName: true, email: true, type: true },
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

    // Create conversation + first message in a transaction
    const conversation = await this.prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          coopId,
          subject: dto.subject,
          type: dto.type,
          createdById: userId,
        },
      });

      // Create first message
      const message = await tx.message.create({
        data: {
          conversationId: conv.id,
          senderType: 'ADMIN',
          senderId: userId,
          body: dto.body,
        },
      });

      // Create attachments for existing documents
      if (dto.existingDocumentIds?.length) {
        await tx.messageAttachment.createMany({
          data: dto.existingDocumentIds.map((docId) => ({
            messageId: message.id,
            type: 'EXISTING_DOCUMENT',
            shareholderDocumentId: docId,
            fileName: '', // Will be resolved on read
          })),
        });
      }

      // Create participants
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

    // Queue email notifications (outside transaction)
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

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderType: 'ADMIN',
        senderId: userId,
        body: dto.body,
      },
    });

    if (dto.existingDocumentIds?.length) {
      await this.prisma.messageAttachment.createMany({
        data: dto.existingDocumentIds.map((docId) => ({
          messageId: message.id,
          type: 'EXISTING_DOCUMENT',
          shareholderDocumentId: docId,
          fileName: '',
        })),
      });
    }

    // Touch conversation updatedAt so it becomes "unread" for participants
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    await this.notifyParticipants(conversationId, coopId);

    return message;
  }

  // === Shareholder methods ===

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
          readAt: new Date(), // Creator has "read" it
        },
      });

      return conv;
    });

    // Notify coop admins
    await this.notifyAdmins(conversation.id, coopId);

    return conversation;
  }

  async addShareholderReply(
    conversationId: string,
    shareholderId: string,
    body: string,
  ) {
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

    // Touch conversation updatedAt
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    // Mark as read for this shareholder (they just wrote it)
    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { readAt: new Date() },
    });

    // Notify admins of the reply
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

  // === Notifications ===

  private async notifyParticipants(conversationId: string, coopId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          include: {
            shareholder: { select: { email: true, firstName: true } },
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

    for (const participant of conversation.participants) {
      if (!participant.shareholder.email) continue;
      await this.emailService.send({
        coopId,
        to: participant.shareholder.email,
        subject: `${coop.name}: ${conversation.subject}`,
        templateKey: 'message-notification',
        templateData: {
          coopName: coop.name,
          shareholderName: participant.shareholder.firstName || '',
          messageSubject: conversation.subject,
          messagePreview: conversation.messages[0]?.body.slice(0, 150) || '',
          inboxUrl: `https://opencoop.be/${coop.slug}/dashboard/inbox`,
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

    // Find all coop admin emails
    const admins = await this.prisma.coopAdmin.findMany({
      where: { coopId },
      include: { user: { select: { email: true, firstName: true } } },
    });

    for (const admin of admins) {
      await this.emailService.send({
        coopId,
        to: admin.user.email,
        subject: `${coop.name}: Nieuw bericht - ${conversation.subject}`,
        templateKey: 'admin-message-notification',
        templateData: {
          coopName: coop.name,
          adminName: admin.user.firstName || '',
          messageSubject: conversation.subject,
          messagePreview: conversation.messages[0]?.body.slice(0, 150) || '',
        },
      });
    }
  }
}
```

**Step 3: Create module**

`messages.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';

@Module({
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
```

**Step 4: Commit**

```bash
git add apps/api/src/modules/messages/
git commit -m "feat(messaging): add messages service, module, and DTOs"
```

---

### Task 3: Backend — Admin Endpoints

**Files:**
- Modify: `apps/api/src/modules/admin/admin.controller.ts`
- Modify: `apps/api/src/modules/admin/admin.module.ts`

**Step 1: Import MessagesModule in admin.module.ts**

Add `MessagesModule` to the imports array alongside the other feature modules.

**Step 2: Add MessagesService to AdminController constructor**

Add import at top:
```typescript
import { MessagesService } from '../messages/messages.service';
import { CreateConversationDto } from '../messages/dto/create-conversation.dto';
import { CreateMessageDto } from '../messages/dto/create-message.dto';
```

Add to constructor:
```typescript
private messagesService: MessagesService,
```

**Step 3: Add admin conversation endpoints**

Add after the existing dividend endpoints section (after line ~700):

```typescript
  // ==================== MESSAGES ====================

  @Get('conversations')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'List all conversations for this coop' })
  async listConversations(
    @Param('coopId') coopId: string,
    @Query('page') page?: number,
  ) {
    return this.messagesService.findAllForCoop(coopId, Number(page) || 1);
  }

  @Post('conversations')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'Create a new conversation (broadcast or direct)' })
  async createConversation(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() dto: CreateConversationDto,
  ) {
    return this.messagesService.createConversation(
      coopId,
      dto,
      user.id,
      req.ip,
      req.headers['user-agent'] as string,
    );
  }

  @Get('conversations/:conversationId')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'Get conversation detail with messages' })
  async getConversation(
    @Param('coopId') coopId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.messagesService.findByIdForAdmin(conversationId, coopId);
  }

  @Post('conversations/:conversationId/messages')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'Reply to a conversation' })
  async replyToConversation(
    @Param('coopId') coopId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateMessageDto,
  ) {
    return this.messagesService.addAdminReply(conversationId, coopId, dto, user.id);
  }
```

**Step 4: Add `canManageMessages` permission**

Find the permissions/roles definitions in the codebase (likely in seed or roles setup) and add `canManageMessages: true` to the default COOP_ADMIN role. Check:
- `packages/database/prisma/schema.prisma` for `CoopRole` model
- Seed files for default role permissions

**Step 5: Commit**

```bash
git add apps/api/src/modules/admin/
git commit -m "feat(messaging): add admin conversation endpoints"
```

---

### Task 4: Backend — Shareholder Endpoints

**Files:**
- Modify: `apps/api/src/modules/shareholders/shareholder-actions.controller.ts`
- Modify: `apps/api/src/modules/shareholders/shareholders.module.ts`

**Step 1: Import MessagesModule in shareholders.module.ts**

Add `MessagesModule` to imports.

**Step 2: Add endpoints to shareholder-actions.controller.ts**

Add imports:
```typescript
import { MessagesService } from '../messages/messages.service';
import { CreateMessageDto } from '../messages/dto/create-message.dto';
```

Add to constructor:
```typescript
private messagesService: MessagesService,
```

Add endpoints:

```typescript
  @Get('conversations')
  @ApiOperation({ summary: 'List conversations for this shareholder' })
  async listConversations(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const shareholder = await this.verifyShareholder(shareholderId, user.id);
    return this.messagesService.findAllForShareholder(shareholderId);
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Start a new conversation with the coop' })
  async createConversation(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateMessageDto & { subject: string },
  ) {
    const shareholder = await this.verifyShareholder(shareholderId, user.id);
    return this.messagesService.createShareholderConversation(
      shareholderId,
      shareholder.coop.id,
      dto.subject,
      dto.body,
      user.id,
    );
  }

  @Get('conversations/:conversationId')
  @ApiOperation({ summary: 'Read a conversation (marks as read)' })
  async getConversation(
    @Param('shareholderId') shareholderId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.verifyShareholder(shareholderId, user.id);
    return this.messagesService.findByIdForShareholder(conversationId, shareholderId);
  }

  @Post('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'Reply to a conversation' })
  async replyToConversation(
    @Param('shareholderId') shareholderId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateMessageDto,
  ) {
    await this.verifyShareholder(shareholderId, user.id);
    return this.messagesService.addShareholderReply(conversationId, shareholderId, dto.body);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread conversation count for badge' })
  async getUnreadCount(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.verifyShareholder(shareholderId, user.id);
    return { count: await this.messagesService.getUnreadCount(shareholderId) };
  }
```

**Step 3: Update `verifyShareholder` to include coop**

The existing `verifyShareholder` method needs to include `coop: { select: { id: true } }` in its query if it doesn't already — check current implementation. The shareholder-initiated conversation needs `shareholder.coop.id`.

**Step 4: Commit**

```bash
git add apps/api/src/modules/shareholders/
git commit -m "feat(messaging): add shareholder conversation endpoints"
```

---

### Task 5: Backend — File Upload for Message Attachments

**Files:**
- Modify: `apps/api/src/modules/messages/messages.service.ts`
- Modify: `apps/api/src/modules/admin/admin.controller.ts`

**Step 1: Add upload endpoint to admin controller**

```typescript
  @Post('conversations/:conversationId/messages/:messageId/attachments')
  @RequirePermission('canManageMessages')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload attachment to a message' })
  async uploadAttachment(
    @Param('coopId') coopId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.messagesService.addUploadedAttachment(conversationId, coopId, messageId, file);
  }
```

**Step 2: Add `addUploadedAttachment` method to service**

```typescript
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

    // Save file to disk
    const uploadDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'messages');
    await fs.promises.mkdir(uploadDir, { recursive: true });
    const filename = `${Date.now()}-${path.basename(file.originalname)}`;
    const filePath = path.join(uploadDir, filename);
    await fs.promises.writeFile(filePath, file.buffer);

    // Create attachment record
    const attachment = await this.prisma.messageAttachment.create({
      data: {
        messageId,
        type: 'UPLOADED_FILE',
        filePath: `messages/${filename}`,
        fileName: file.originalname,
        mimeType: file.mimetype,
      },
    });

    // For broadcast: create ShareholderDocument for each participant
    if (conversation.type === 'BROADCAST') {
      const participants = await this.prisma.conversationParticipant.findMany({
        where: { conversationId },
        select: { shareholderId: true },
      });
      if (participants.length > 0) {
        await this.prisma.shareholderDocument.createMany({
          data: participants.map((p) => ({
            id: `doc-${attachment.id}-${p.shareholderId}`,
            shareholderId: p.shareholderId,
            type: 'CORRESPONDENCE',
            filePath: `messages/${filename}`,
            generatedAt: new Date(),
          })),
        });
      }
    } else {
      // Direct: create for the single participant
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
```

**Step 3: Add attachment download endpoint**

Add to shareholder-actions controller:
```typescript
  @Get('conversations/:conversationId/attachments/:attachmentId')
  @ApiOperation({ summary: 'Download a message attachment' })
  async downloadAttachment(
    @Param('shareholderId') shareholderId: string,
    @Param('conversationId') conversationId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    await this.verifyShareholder(shareholderId, user.id);
    // Verify participation
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_shareholderId: { conversationId, shareholderId } },
    });
    if (!participant) throw new NotFoundException('Conversation not found');

    const attachment = await this.prisma.messageAttachment.findUnique({
      where: { id: attachmentId },
      include: { message: true },
    });
    if (!attachment || attachment.message.conversationId !== conversationId) {
      throw new NotFoundException('Attachment not found');
    }

    if (attachment.type === 'UPLOADED_FILE' && attachment.filePath) {
      const fullPath = path.join(process.env.UPLOAD_DIR || 'uploads', attachment.filePath);
      if (!fs.existsSync(fullPath)) throw new NotFoundException('File not found');
      res.setHeader('Content-Disposition', `attachment; filename="${attachment.fileName}"`);
      if (attachment.mimeType) res.setHeader('Content-Type', attachment.mimeType);
      fs.createReadStream(fullPath).pipe(res);
    } else {
      throw new BadRequestException('Use document download endpoint for existing documents');
    }
  }
```

**Step 4: Commit**

```bash
git add apps/api/src/modules/messages/ apps/api/src/modules/admin/ apps/api/src/modules/shareholders/
git commit -m "feat(messaging): add file upload and download for attachments"
```

---

### Task 6: Backend — Email Templates

**Files:**
- Modify: `apps/api/src/modules/email/email.processor.ts`

**Step 1: Add `message-notification` and `admin-message-notification` templates**

Find the template rendering section in `email.processor.ts` and add the two new template cases. Follow the existing pattern (simple string interpolation with `{{variableName}}`).

`message-notification` template (to shareholders):
```
Subject: {{coopName}}: {{messageSubject}}
Body:
  Beste {{shareholderName}},

  U heeft een nieuw bericht ontvangen van {{coopName}}.

  Onderwerp: {{messageSubject}}

  {{messagePreview}}...

  Bekijk het volledige bericht in uw inbox:
  {{inboxUrl}}

  Met vriendelijke groeten,
  {{coopName}}
```

`admin-message-notification` template (to admins):
```
Subject: {{coopName}}: Nieuw bericht - {{messageSubject}}
Body:
  Beste {{adminName}},

  Er is een nieuw bericht ontvangen in {{coopName}}.

  Onderwerp: {{messageSubject}}

  {{messagePreview}}...

  Bekijk het bericht in het admin dashboard.

  Met vriendelijke groeten,
  OpenCoop
```

**Step 2: Commit**

```bash
git add apps/api/src/modules/email/
git commit -m "feat(messaging): add email notification templates for messages"
```

---

### Task 7: Frontend — Translations

**Files:**
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/nl.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/de.json`

**Step 1: Add message translation keys to all 4 files**

Add a `"messages"` section:

English:
```json
"messages": {
  "title": "Inbox",
  "newConversation": "New Message",
  "noConversations": "No messages yet.",
  "typeMessage": "Type your message...",
  "send": "Send",
  "subject": "Subject",
  "body": "Message",
  "allShareholders": "All shareholders",
  "specificShareholder": "Specific shareholder",
  "broadcast": "Broadcast",
  "direct": "Direct",
  "unread": "Unread",
  "read": "Read",
  "participants": "Participants",
  "attachments": "Attachments",
  "attachFile": "Attach file",
  "attachExistingDocument": "Attach existing document",
  "selectShareholder": "Select shareholder",
  "messageSent": "Message sent",
  "replyPlaceholder": "Write your reply...",
  "startConversation": "New Message",
  "subjectPlaceholder": "Subject of your message"
}
```

Dutch (`nl.json`):
```json
"messages": {
  "title": "Berichten",
  "newConversation": "Nieuw bericht",
  "noConversations": "Nog geen berichten.",
  "typeMessage": "Typ uw bericht...",
  "send": "Versturen",
  "subject": "Onderwerp",
  "body": "Bericht",
  "allShareholders": "Alle aandeelhouders",
  "specificShareholder": "Specifieke aandeelhouder",
  "broadcast": "Uitzending",
  "direct": "Direct",
  "unread": "Ongelezen",
  "read": "Gelezen",
  "participants": "Deelnemers",
  "attachments": "Bijlagen",
  "attachFile": "Bestand bijvoegen",
  "attachExistingDocument": "Bestaand document bijvoegen",
  "selectShareholder": "Selecteer aandeelhouder",
  "messageSent": "Bericht verstuurd",
  "replyPlaceholder": "Schrijf uw antwoord...",
  "startConversation": "Nieuw bericht",
  "subjectPlaceholder": "Onderwerp van uw bericht"
}
```

French and German: translate similarly.

**Step 2: Commit**

```bash
git add apps/web/messages/
git commit -m "feat(messaging): add inbox translations for all 4 locales"
```

---

### Task 8: Frontend — Shareholder Inbox Page

**Files:**
- Create: `apps/web/src/app/[locale]/dashboard/inbox/page.tsx`
- Create: `apps/web/src/app/[locale]/dashboard/inbox/[conversationId]/page.tsx`

**Step 1: Create inbox list page**

`inbox/page.tsx` — shows list of conversations for the logged-in shareholder. Use the same patterns as `dashboard/documents/page.tsx`:
- Load data via `api<T>('/shareholders/{shareholderId}/conversations')`
- Get `shareholderId` from the user profile (same as shares page)
- Show unread conversations in bold
- Each row: subject, preview of last message, date, unread badge
- "New Message" button to start a conversation
- Use `Table` component from `@/components/ui/table`

**Step 2: Create conversation detail page**

`inbox/[conversationId]/page.tsx` — shows messages in a conversation:
- Load via `api<T>('/shareholders/{shareholderId}/conversations/{conversationId}')`
- Opening this page marks it as read (API handles it)
- Messages displayed chronologically, admin messages on left, shareholder on right (or use sender label)
- Attachments shown as download links
- Reply textarea + send button at bottom
- Reply posts to `POST /shareholders/{shareholderId}/conversations/{conversationId}/messages`

**Step 3: Add new conversation dialog**

Add a dialog/modal on the inbox page for shareholders to start a new conversation:
- Subject input
- Body textarea
- Submit creates conversation via `POST /shareholders/{shareholderId}/conversations`

**Step 4: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/inbox/
git commit -m "feat(messaging): add shareholder inbox and conversation pages"
```

---

### Task 9: Frontend — Admin Messages Pages

**Files:**
- Create: `apps/web/src/app/[locale]/dashboard/admin/messages/page.tsx`
- Create: `apps/web/src/app/[locale]/dashboard/admin/messages/new/page.tsx`
- Create: `apps/web/src/app/[locale]/dashboard/admin/messages/[conversationId]/page.tsx`

**Step 1: Create admin messages list**

`messages/page.tsx` — list all conversations for this coop:
- Load via `api<T>('/admin/coops/{coopId}/conversations?page=N')`
- Show type badge (BROADCAST / DIRECT), subject, last message preview, participant count, date
- Pagination
- "New Message" button linking to `/dashboard/admin/messages/new`

**Step 2: Create compose page**

`messages/new/page.tsx`:
- Toggle: "All shareholders" (BROADCAST) or "Specific shareholder" (DIRECT)
- For DIRECT: shareholder search/select dropdown (load from existing shareholders API)
- Subject input
- Body textarea
- Attach existing document (dropdown of recent documents) or upload file
- Submit creates conversation via `POST /admin/coops/{coopId}/conversations`

**Step 3: Create admin conversation detail**

`messages/[conversationId]/page.tsx`:
- Load via `GET /admin/coops/{coopId}/conversations/{conversationId}`
- Show all messages chronologically
- Show participant list with read/unread status for broadcasts
- Reply box at bottom
- File upload button

**Step 4: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/messages/
git commit -m "feat(messaging): add admin messages, compose, and conversation pages"
```

---

### Task 10: Frontend — Navigation & Unread Badge

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/layout.tsx`

**Step 1: Add inbox to shareholder nav**

In `layout.tsx`, add to the `shareholderNav` array (around line 142, after documents):
```typescript
{ href: '/dashboard/inbox', label: t('messages.title'), icon: <Mail className="h-4 w-4" />, badge: unreadCount },
```

Import `Mail` from `lucide-react`.

**Step 2: Fetch unread count**

In the layout's data loading, fetch the unread count:
```typescript
const unreadRes = await api<{ count: number }>(`/shareholders/${shareholder.id}/unread-count`);
const unreadCount = unreadRes.count || 0;
```

Add this alongside the existing `adminStats` fetch. Only fetch if user has a shareholder profile.

**Step 3: Add messages to admin nav**

Add to the `adminNav` array (around line 155, after dividends):
```typescript
hasPermission('canManageMessages') && { href: '/dashboard/admin/messages', label: t('messages.title'), icon: <Mail className="h-4 w-4" /> },
```

**Step 4: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/layout.tsx
git commit -m "feat(messaging): add inbox nav items and unread badge"
```

---

### Task 11: Integration Test & Verification

**Step 1: Test the full flow manually**

1. Start dev servers: `pnpm dev`
2. Log in as coop admin
3. Navigate to Messages page
4. Create a broadcast message with subject "Test AV Invite"
5. Verify it appears in the list
6. Log in as a shareholder
7. Verify inbox shows the message with unread badge
8. Open the conversation, verify it marks as read
9. Reply to the conversation
10. Verify admin sees the reply
11. Test shareholder starting a new conversation
12. Test file upload attachment

**Step 2: Verify email notifications**

Check Redis queue / email logs for notification jobs being created.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(messaging): integration fixes and polish"
```
