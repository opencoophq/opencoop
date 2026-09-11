import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { McpAuthStore } from '../mcp-auth.store';
import { MessagesService } from '../../messages/messages.service';
import { markdownToMessageHtml } from '../../messages/message-body';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { PrismaService } from '../../../prisma/prisma.service';

const audienceSchema = z.object({
  type: z.enum(['ALL', 'PROJECT', 'SELECTED']),
  projectId: z.string().optional().describe('Project id, for type PROJECT'),
  projectName: z.string().optional().describe('Exact project name, alternative to projectId, for type PROJECT'),
  shareholderIds: z.array(z.string()).optional().describe('Shareholder ids, for type SELECTED'),
});
type AudienceInput = z.infer<typeof audienceSchema>;

/**
 * Draft-only messaging tools for API keys. These can create and edit DRAFT
 * conversations and nothing else: no send, no schedule, no participants.
 * Sending is an admin-UI action by a logged-in user.
 */
@Injectable()
export class McpMessageTools {
  constructor(
    private readonly auth: McpAuthStore,
    private readonly messages: MessagesService,
    private readonly permissions: CoopPermissionsService,
    private readonly prisma: PrismaService,
  ) {}

  private async requirePermission(): Promise<{ userId: string; coopId: string; apiKeyId?: string }> {
    const userId = this.auth.getUserId();
    const coopId = this.auth.getCoopId();
    if (!(await this.permissions.has(userId, coopId, 'canManageMessages'))) {
      throw new ForbiddenException('This API key\'s user may not manage messages for this coop');
    }
    return { userId, coopId, apiKeyId: this.auth.getApiKeyId() };
  }

  private async resolveAudience(coopId: string, a: AudienceInput) {
    if (a.type === 'PROJECT' && !a.projectId && a.projectName) {
      const project = await this.prisma.project.findFirst({ where: { coopId, name: a.projectName }, select: { id: true } });
      if (!project) throw new NotFoundException(`Project "${a.projectName}" not found`);
      return { type: 'PROJECT' as const, projectId: project.id };
    }
    if (a.type === 'PROJECT') return { type: 'PROJECT' as const, projectId: a.projectId };
    if (a.type === 'SELECTED') return { type: 'SELECTED' as const, shareholderIds: a.shareholderIds ?? [] };
    return { type: 'ALL' as const };
  }

  private adminUrl(conversationId: string) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://opencoop.be';
    return `${appUrl}/nl/dashboard/admin/messages/${conversationId}`;
  }

  private async describe(conversationId: string, coopId: string) {
    const conv = await this.messages.findByIdForAdmin(conversationId, coopId);
    const first = conv.messages[0];
    return {
      id: conv.id,
      status: conv.status,
      subject: conv.subject,
      bodyHtml: first?.body ?? '',
      audience: { type: conv.audienceType, projectId: conv.audienceProjectId, shareholderIds: conv.audienceShareholderIds },
      recipientCount: await this.messages.countRecipients(conversationId, coopId),
      adminUrl: this.adminUrl(conv.id),
    };
  }

  @Tool({
    name: 'create_message_draft',
    description:
      'Create a DRAFT message to shareholders. It is not sent: an admin reviews it in the dashboard and sends or schedules it. Body is Markdown (headings, bold, lists, links). Audience: ALL shareholders, one PROJECT (by id or exact name), or SELECTED shareholder ids. Returns the draft id, recipient count and the admin URL.',
    parameters: z.object({
      subject: z.string().min(1),
      bodyMarkdown: z.string().min(1),
      audience: audienceSchema,
    }),
  })
  async createMessageDraft(params: { subject: string; bodyMarkdown: string; audience: AudienceInput }) {
    const { userId, coopId, apiKeyId } = await this.requirePermission();
    const audience = await this.resolveAudience(coopId, params.audience);
    const conv = await this.messages.createConversation(
      coopId,
      { type: 'BROADCAST', status: 'DRAFT', format: 'HTML', subject: params.subject, body: markdownToMessageHtml(params.bodyMarkdown), audience },
      userId,
      undefined,
      'mcp',
      { apiKeyId },
    );
    return JSON.stringify(await this.describe(conv.id, coopId), null, 2);
  }

  @Tool({
    name: 'update_message_draft',
    description: 'Edit the subject, Markdown body or audience of a DRAFT message. Fails on sent or scheduled messages.',
    parameters: z.object({
      conversationId: z.string(),
      subject: z.string().min(1).optional(),
      bodyMarkdown: z.string().min(1).optional(),
      audience: audienceSchema.optional(),
    }),
  })
  async updateMessageDraft(params: { conversationId: string; subject?: string; bodyMarkdown?: string; audience?: AudienceInput }) {
    const { userId, coopId } = await this.requirePermission();
    const dto: Record<string, unknown> = {};
    if (params.subject !== undefined) dto.subject = params.subject;
    if (params.bodyMarkdown !== undefined) {
      dto.body = markdownToMessageHtml(params.bodyMarkdown);
      dto.format = 'HTML';
    }
    if (params.audience) dto.audience = await this.resolveAudience(coopId, params.audience);
    await this.messages.updateDraft(params.conversationId, coopId, dto, userId);
    return JSON.stringify(await this.describe(params.conversationId, coopId), null, 2);
  }

  @Tool({
    name: 'get_message_draft',
    description: 'Read a message (draft, scheduled or sent): status, subject, HTML body, audience, recipient count and the admin URL.',
    parameters: z.object({ conversationId: z.string() }),
  })
  async getMessageDraft(params: { conversationId: string }) {
    const { coopId } = await this.requirePermission();
    return JSON.stringify(await this.describe(params.conversationId, coopId), null, 2);
  }
}
