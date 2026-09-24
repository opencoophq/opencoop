import { Injectable, NotFoundException } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { PrismaService } from '../../../prisma/prisma.service';
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

type CreateMessageDraftParams = z.infer<typeof createMessageDraftParameters>;
type UpdateMessageDraftParams = z.infer<typeof updateMessageDraftParameters>;
type GetMessageDraftParams = z.infer<typeof getMessageDraftParameters>;

/**
 * Draft-only messaging tools for API keys. These can create and edit DRAFT
 * conversations and nothing else: no send, no schedule, no participants.
 * Sending is an admin-UI action by a logged-in user.
 */
@Injectable()
export class McpMessageTools {
  constructor(
    private readonly toolkit: McpToolkit,
    private readonly messages: MessagesService,
    private readonly prisma: PrismaService,
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
}
