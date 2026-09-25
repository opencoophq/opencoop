import { Injectable, NotFoundException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { PrismaService } from '../../../prisma/prisma.service';
import { AudienceService } from '../../messages/audience.service';
import { CreateConversationDto } from '../../messages/dto/create-conversation.dto';
import { CreateMessageDto } from '../../messages/dto/create-message.dto';
import { ScheduleConversationDto } from '../../messages/dto/schedule-conversation.dto';
import { MessagesService } from '../../messages/messages.service';
import { markdownToMessageHtml } from '../../messages/message-body';
import { McpToolkit } from '../mcp-toolkit';

export const audienceSchema = z
  .object({
    type: z.enum(['ALL', 'PROJECT', 'SELECTED']),
    projectId: z.string().optional().describe('Project id, for type PROJECT'),
    projectName: z
      .string()
      .optional()
      .describe('Exact project name, alternative to projectId, for type PROJECT'),
    shareholderIds: z.array(z.string()).optional().describe('Shareholder ids, for type SELECTED'),
  })
  .strict();
type AudienceInput = z.infer<typeof audienceSchema>;

const createConversationAudienceParameters = z
  .object({
    type: z.enum(['ALL', 'PROJECT', 'SELECTED']),
    projectId: z.string().optional(),
    shareholderIds: z.array(z.string()).optional(),
  })
  .strict();

export const createConversationParameters = z
  .object({
    subject: z.string().min(1),
    type: z.enum(['BROADCAST', 'DIRECT']),
    body: z.string().min(1),
    format: z.enum(['TEXT', 'HTML']).optional(),
    status: z.enum(['DRAFT', 'SENT']).optional(),
    audience: createConversationAudienceParameters.optional(),
    shareholderId: z.string().optional(),
    existingDocumentIds: z.array(z.string()).optional(),
  })
  .strict();

export const createMessageDraftParameters = z
  .object({
    subject: z.string().min(1),
    bodyMarkdown: z.string().min(1),
    audience: audienceSchema,
  })
  .strict();

export const updateMessageDraftParameters = z
  .object({
    conversationId: z.string(),
    subject: z.string().min(1).optional(),
    bodyMarkdown: z.string().min(1).optional(),
    audience: audienceSchema.optional(),
  })
  .strict();

export const getMessageDraftParameters = z
  .object({
    conversationId: z.string(),
  })
  .strict();

export const listConversationsParameters = z
  .object({
    page: z.number().int().min(1).optional(),
  })
  .strict();

export const getConversationParameters = z
  .object({
    conversationId: z.string(),
  })
  .strict();

export const sendMessageDraftParameters = z
  .object({
    conversationId: z.string(),
  })
  .strict();

export const scheduleMessageDraftParameters = z
  .object({
    conversationId: z.string(),
    scheduledAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const unscheduleMessageDraftParameters = z
  .object({
    conversationId: z.string(),
  })
  .strict();

export const replyToConversationParameters = z
  .object({
    conversationId: z.string(),
    body: z.string().min(1),
    existingDocumentIds: z.array(z.string()).optional(),
  })
  .strict();

type CreateMessageDraftParams = z.infer<typeof createMessageDraftParameters>;
type CreateConversationParams = z.infer<typeof createConversationParameters>;
type UpdateMessageDraftParams = z.infer<typeof updateMessageDraftParameters>;
type GetMessageDraftParams = z.infer<typeof getMessageDraftParameters>;
type ListConversationsParams = z.infer<typeof listConversationsParameters>;
type GetConversationParams = z.infer<typeof getConversationParameters>;
type SendMessageDraftParams = z.infer<typeof sendMessageDraftParameters>;
type ScheduleMessageDraftParams = z.infer<typeof scheduleMessageDraftParameters>;
type UnscheduleMessageDraftParams = z.infer<typeof unscheduleMessageDraftParameters>;
type ReplyToConversationParams = z.infer<typeof replyToConversationParameters>;

class ScheduleMessageDraftToolDto extends ScheduleConversationDto {
  @IsString()
  conversationId!: string;
}

class ReplyToConversationToolDto extends CreateMessageDto {
  @IsString()
  conversationId!: string;
}

/**
 * Messaging tools for API keys that can manage messages. A READ_WRITE key with
 * canManageMessages can create, schedule, send, and reply; READ_ONLY keys and
 * callers without that permission cannot.
 */
@Injectable()
export class McpMessageTools {
  constructor(
    private readonly toolkit: McpToolkit,
    private readonly messages: MessagesService,
    private readonly prisma: PrismaService,
    private readonly audienceService: AudienceService,
  ) {}

  private async resolveAudience(coopId: string, audienceInput: AudienceInput) {
    if (audienceInput.type !== 'PROJECT') {
      if (audienceInput.type === 'SELECTED') {
        return {
          type: 'SELECTED' as const,
          shareholderIds: audienceInput.shareholderIds ?? [],
        };
      }
      return { type: 'ALL' as const };
    }

    if (!audienceInput.projectId && audienceInput.projectName) {
      const project = await this.prisma.project.findFirst({
        where: { coopId, name: audienceInput.projectName },
        select: { id: true },
      });
      if (!project) throw new NotFoundException(`Project "${audienceInput.projectName}" not found`);
      return { type: 'PROJECT' as const, projectId: project.id };
    }

    if (!audienceInput.projectId) {
      throw new NotFoundException('Project not found');
    }

    const project = await this.prisma.project.findFirst({
      where: { id: audienceInput.projectId, coopId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return { type: 'PROJECT' as const, projectId: project.id };
  }

  private adminUrl(conversationId: string) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    return `${frontendUrl}/en/dashboard/admin/messages/${conversationId}`;
  }

  private async describe(conversationId: string, coopId: string) {
    const conv = await this.messages.findByIdForAdmin(conversationId, coopId);
    const first = conv.messages[0];
    return {
      id: conv.id,
      status: conv.status,
      subject: conv.subject,
      bodyHtml: first?.body ?? '',
      audience: {
        type: conv.audienceType,
        projectId: conv.audienceProjectId,
        shareholderIds: conv.audienceShareholderIds,
      },
      recipientCount: await this.messages.countRecipients(conversationId, coopId),
      adminUrl: this.adminUrl(conv.id),
    };
  }

  // Mirrors POST admin/coops/:coopId/conversations
  @Tool({
    name: 'create_conversation',
    description:
      'Create a conversation: BROADCAST (to an audience) or DIRECT (a 1:1 conversation with one shareholder, via shareholderId). Unless status is DRAFT, this sends immediately and irreversibly, emailing the recipient(s) right away.',
    parameters: createConversationParameters,
  })
  async createConversation(params: CreateConversationParams) {
    return this.toolkit.run(
      { permission: 'canManageMessages', write: true, dto: CreateConversationDto },
      params,
      async (ctx, dto) =>
        this.messages.createConversation(ctx.coopId, dto, ctx.userId, undefined, 'mcp', {
          apiKeyId: ctx.apiKeyId,
        }),
    );
  }

  // Mirrors POST admin/coops/:coopId/conversations
  @Tool({
    name: 'create_message_draft',
    description:
      'Create a DRAFT message to shareholders. It is not sent: an admin reviews it in the dashboard and sends or schedules it. Body is Markdown (headings, bold, lists, links). Audience: ALL shareholders, one PROJECT (by id or exact name), or SELECTED shareholder ids. Returns the draft id, recipient count and the admin URL.',
    parameters: createMessageDraftParameters,
  })
  async createMessageDraft(params: CreateMessageDraftParams) {
    return this.toolkit.run(
      { permission: 'canManageMessages', write: true },
      params,
      async (ctx) => {
        const audience = await this.resolveAudience(ctx.coopId, params.audience);
        const conv = await this.messages.createConversation(
          ctx.coopId,
          {
            type: 'BROADCAST',
            status: 'DRAFT',
            format: 'HTML',
            subject: params.subject,
            body: markdownToMessageHtml(params.bodyMarkdown),
            audience,
          },
          ctx.userId,
          undefined,
          'mcp',
          { apiKeyId: ctx.apiKeyId },
        );
        return this.describe(conv.id, ctx.coopId);
      },
    );
  }

  // Mirrors PATCH admin/coops/:coopId/conversations/:conversationId
  @Tool({
    name: 'update_message_draft',
    description:
      'Edit the subject, Markdown body or audience of a DRAFT message. Fails on sent or scheduled messages.',
    parameters: updateMessageDraftParameters,
  })
  async updateMessageDraft(params: UpdateMessageDraftParams) {
    return this.toolkit.run(
      { permission: 'canManageMessages', write: true },
      params,
      async (ctx) => {
        const dto: Record<string, unknown> = {};
        if (params.subject !== undefined) dto.subject = params.subject;
        if (params.bodyMarkdown !== undefined) {
          dto.body = markdownToMessageHtml(params.bodyMarkdown);
          dto.format = 'HTML';
        }
        if (params.audience) dto.audience = await this.resolveAudience(ctx.coopId, params.audience);
        await this.messages.updateDraft(params.conversationId, ctx.coopId, dto, ctx.userId);
        return this.describe(params.conversationId, ctx.coopId);
      },
    );
  }

  // Mirrors GET admin/coops/:coopId/conversations/:conversationId
  @Tool({
    name: 'get_message_draft',
    description:
      'Read a message (draft, scheduled or sent): status, subject, HTML body, audience, recipient count and the admin URL.',
    parameters: getMessageDraftParameters,
  })
  async getMessageDraft(params: GetMessageDraftParams) {
    return this.toolkit.run({ permission: 'canManageMessages' }, params, async (ctx) =>
      this.describe(params.conversationId, ctx.coopId),
    );
  }

  // Mirrors GET admin/coops/:coopId/conversations
  @Tool({
    name: 'list_conversations',
    description: 'List conversations for the cooperative with optional pagination.',
    parameters: listConversationsParameters,
  })
  async listConversations(params: ListConversationsParams) {
    return this.toolkit.run({ permission: 'canManageMessages' }, params, async (ctx) =>
      this.messages.findAllForCoop(ctx.coopId, params.page ?? 1),
    );
  }

  // Mirrors GET admin/coops/:coopId/conversations/:conversationId
  @Tool({
    name: 'get_conversation',
    description: 'Read a conversation and return its full message history and participants.',
    parameters: getConversationParameters,
  })
  async getConversation(params: GetConversationParams) {
    return this.toolkit.run({ permission: 'canManageMessages' }, params, async (ctx) =>
      this.messages.findByIdForAdmin(params.conversationId, ctx.coopId),
    );
  }

  // Mirrors POST admin/coops/:coopId/conversations/audience-preview
  @Tool({
    name: 'preview_message_audience',
    description: 'Resolve an audience and return the number of active recipients it contains.',
    parameters: audienceSchema,
  })
  async previewMessageAudience(params: AudienceInput) {
    return this.toolkit.run({ permission: 'canManageMessages' }, params, async (ctx) => {
      const audience = await this.resolveAudience(ctx.coopId, params);
      const { shareholderIds } = await this.audienceService.resolve(ctx.coopId, audience);
      return { count: shareholderIds.length };
    });
  }

  // Mirrors POST admin/coops/:coopId/conversations/:conversationId/send
  @Tool({
    name: 'send_message_draft',
    description:
      'Send a draft immediately and irreversibly. This emails every recipient; check the recipient count first with preview_message_audience.',
    parameters: sendMessageDraftParameters,
  })
  async sendMessageDraft(params: SendMessageDraftParams) {
    return this.toolkit.run({ permission: 'canManageMessages', write: true }, params, async (ctx) =>
      this.messages.send(params.conversationId, ctx.coopId, {
        userId: ctx.audit.userId,
        ip: ctx.audit.ip,
        userAgent: ctx.audit.userAgent,
      }),
    );
  }

  // Mirrors POST admin/coops/:coopId/conversations/:conversationId/schedule
  @Tool({
    name: 'schedule_message_draft',
    description: 'Schedule a draft for a future time and return the updated conversation.',
    parameters: scheduleMessageDraftParameters,
  })
  async scheduleMessageDraft(params: ScheduleMessageDraftParams) {
    return this.toolkit.run(
      { permission: 'canManageMessages', write: true, dto: ScheduleMessageDraftToolDto },
      params,
      async (ctx, dto) =>
        this.messages.schedule(
          dto.conversationId,
          ctx.coopId,
          new Date(dto.scheduledAt),
          ctx.userId,
        ),
    );
  }

  // Mirrors POST admin/coops/:coopId/conversations/:conversationId/cancel-schedule
  @Tool({
    name: 'unschedule_message_draft',
    description: 'Cancel a scheduled send and return the conversation to DRAFT status.',
    parameters: unscheduleMessageDraftParameters,
  })
  async unscheduleMessageDraft(params: UnscheduleMessageDraftParams) {
    return this.toolkit.run({ permission: 'canManageMessages', write: true }, params, async (ctx) =>
      this.messages.cancelSchedule(params.conversationId, ctx.coopId, ctx.userId),
    );
  }

  // Mirrors POST admin/coops/:coopId/conversations/:conversationId/messages
  @Tool({
    name: 'reply_to_conversation',
    description: 'Reply to a conversation immediately; this emails all participants.',
    parameters: replyToConversationParameters,
  })
  async replyToConversation(params: ReplyToConversationParams) {
    return this.toolkit.run(
      { permission: 'canManageMessages', write: true, dto: ReplyToConversationToolDto },
      params,
      async (ctx, dto) =>
        this.messages.addAdminReply(
          dto.conversationId,
          ctx.coopId,
          { body: dto.body, existingDocumentIds: dto.existingDocumentIds },
          ctx.userId,
        ),
    );
  }
}
