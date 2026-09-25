import { Test } from '@nestjs/testing';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { PrismaService } from '../../../prisma/prisma.service';
import { AudienceService } from '../../messages/audience.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import { MessagesService } from '../../messages/messages.service';
import {
  McpMessageTools,
  audienceSchema,
  createConversationParameters,
  getConversationParameters,
  listConversationsParameters,
  replyToConversationParameters,
  scheduleMessageDraftParameters,
  sendMessageDraftParameters,
  unscheduleMessageDraftParameters,
} from './mcp-message.tools';

describe('McpMessageTools', () => {
  let tools: McpMessageTools;
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'c1',
    getApiKeyId: () => 'k1',
    getScope: jest.fn((): 'READ_ONLY' | 'READ_WRITE' => 'READ_WRITE'),
  };
  const messages = {
    createConversation: jest.fn(),
    updateDraft: jest.fn(),
    findByIdForAdmin: jest.fn(),
    countRecipients: jest.fn(),
    findAllForCoop: jest.fn(),
    send: jest.fn(),
    schedule: jest.fn(),
    cancelSchedule: jest.fn(),
    addAdminReply: jest.fn(),
  };
  const perms = { permissions: jest.fn(), permissionsWithRole: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const prisma = { project: { findFirst: jest.fn() } };
  const audienceService = { resolve: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpMessageTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: MessagesService, useValue: messages },
        { provide: CoopPermissionsService, useValue: perms },
        { provide: BillingService, useValue: billing },
        { provide: PrismaService, useValue: prisma },
        { provide: AudienceService, useValue: audienceService },
      ],
    }).compile();
    tools = module.get(McpMessageTools);
    jest.clearAllMocks();
    perms.permissionsWithRole.mockImplementation(async () => ({
      permissions: await perms.permissions(),
      role: 'COOP_ADMIN',
    }));
    perms.permissions.mockResolvedValue({ canManageMessages: true, canViewPII: true });
    billing.isReadOnly.mockResolvedValue(false);
    messages.createConversation.mockResolvedValue({ id: 'conv1' });
    messages.updateDraft.mockResolvedValue({});
    messages.countRecipients.mockResolvedValue(62);
    messages.findAllForCoop.mockResolvedValue({
      conversations: [],
      total: 0,
      page: 1,
      totalPages: 0,
    });
    messages.send.mockResolvedValue({ id: 'conv1', status: 'SENT' });
    messages.schedule.mockResolvedValue({ id: 'conv1', status: 'SCHEDULED' });
    messages.cancelSchedule.mockResolvedValue({ id: 'conv1', status: 'DRAFT' });
    messages.addAdminReply.mockResolvedValue({ id: 'message1' });
    audienceService.resolve.mockResolvedValue({ shareholderIds: ['s1', 's2'] });
    messages.findByIdForAdmin.mockResolvedValue({
      id: 'conv1',
      subject: 'S',
      status: 'DRAFT',
      audienceType: 'PROJECT',
      audienceProjectId: 'p1',
      audienceShareholderIds: [],
      messages: [{ body: '<p>hi</p>', format: 'HTML' }],
    });
    process.env.FRONTEND_URL = 'https://frontend.test';
  });

  afterEach(() => {
    delete process.env.FRONTEND_URL;
  });

  it('creates a DRAFT from markdown for a project audience by name', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1', name: 'Onze Energie: Northwind' });
    const out = await tools.createMessageDraft({
      subject: 'S',
      bodyMarkdown: '## Kop\n\nTekst **vet**.',
      audience: { type: 'PROJECT', projectName: 'Onze Energie: Northwind' },
    });

    expect(messages.createConversation).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        type: 'BROADCAST',
        status: 'DRAFT',
        format: 'HTML',
        subject: 'S',
        body: '<h2>Kop</h2>\n<p>Tekst <strong>vet</strong>.</p>',
        audience: { type: 'PROJECT', projectId: 'p1' },
      }),
      'u1',
      undefined,
      'mcp',
      { apiKeyId: 'k1' },
    );
    expect(out).toEqual(
      expect.objectContaining({
        id: 'conv1',
        status: 'DRAFT',
        recipientCount: 62,
        adminUrl: 'https://frontend.test/en/dashboard/admin/messages/conv1',
      }),
    );
  });

  it('creates a SENT BROADCAST conversation without changing the HTML body', async () => {
    await tools.createConversation({
      subject: 'S',
      type: 'BROADCAST',
      body: '<p>Hello shareholders.</p>',
      format: 'HTML',
      status: 'SENT',
      audience: { type: 'ALL' },
      existingDocumentIds: ['document1'],
    });

    expect(messages.createConversation).toHaveBeenCalledWith(
      'c1',
      {
        subject: 'S',
        type: 'BROADCAST',
        body: '<p>Hello shareholders.</p>',
        format: 'HTML',
        status: 'SENT',
        audience: { type: 'ALL' },
        existingDocumentIds: ['document1'],
      },
      'u1',
      undefined,
      'mcp',
      { apiKeyId: 'k1' },
    );
  });

  it('creates a DIRECT conversation for one shareholder', async () => {
    await tools.createConversation({
      subject: 'S',
      type: 'DIRECT',
      body: 'Hello shareholder.',
      shareholderId: 'shareholder1',
    });

    expect(messages.createConversation).toHaveBeenCalledWith(
      'c1',
      {
        subject: 'S',
        type: 'DIRECT',
        body: 'Hello shareholder.',
        shareholderId: 'shareholder1',
      },
      'u1',
      undefined,
      'mcp',
      { apiKeyId: 'k1' },
    );
  });

  it('refuses without canManageMessages', async () => {
    perms.permissions.mockResolvedValue({ canViewPII: true });

    await expect(
      tools.createMessageDraft({
        subject: 'S',
        bodyMarkdown: 'x',
        audience: { type: 'ALL' },
      }),
    ).rejects.toMatchObject({ message: 'Insufficient permissions' });
    expect(messages.createConversation).not.toHaveBeenCalled();
  });

  it('never passes a status other than DRAFT', async () => {
    await tools.createMessageDraft({
      subject: 'S',
      bodyMarkdown: 'x',
      audience: { type: 'ALL' },
    });
    const dto = messages.createConversation.mock.calls[0][1];
    expect(dto.status).toBe('DRAFT');
  });

  it('updates a draft body from markdown', async () => {
    await tools.updateMessageDraft({ conversationId: 'conv1', bodyMarkdown: 'nieuw' });
    expect(messages.updateDraft).toHaveBeenCalledWith(
      'conv1',
      'c1',
      { body: '<p>nieuw</p>', format: 'HTML' },
      'u1',
    );
  });

  it('rejects a project id from another coop before creating or updating', async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      tools.createMessageDraft({
        subject: 'S',
        bodyMarkdown: 'x',
        audience: { type: 'PROJECT', projectId: 'foreign-project' },
      }),
    ).rejects.toMatchObject({ message: 'Project not found' });
    expect(messages.createConversation).not.toHaveBeenCalled();

    await expect(
      tools.updateMessageDraft({
        conversationId: 'conv1',
        audience: { type: 'PROJECT', projectId: 'foreign-project' },
      }),
    ).rejects.toMatchObject({ message: 'Project not found' });
    expect(messages.updateDraft).not.toHaveBeenCalled();
    expect(prisma.project.findFirst).toHaveBeenNthCalledWith(2, {
      where: { id: 'foreign-project', coopId: 'c1' },
      select: { id: true },
    });
  });

  it('get returns status, html, audience, count and admin url', async () => {
    const out = await tools.getMessageDraft({ conversationId: 'conv1' });

    expect(out).toEqual(
      expect.objectContaining({
        id: 'conv1',
        status: 'DRAFT',
        bodyHtml: '<p>hi</p>',
        recipientCount: 62,
        audience: { type: 'PROJECT', projectId: 'p1', shareholderIds: [] },
        adminUrl: 'https://frontend.test/en/dashboard/admin/messages/conv1',
      }),
    );
  });

  it('lists conversations with the authenticated coop and requested page', async () => {
    await tools.listConversations({ page: 3 });

    expect(messages.findAllForCoop).toHaveBeenCalledWith('c1', 3);
  });

  it('gets the full conversation history with the authenticated coop', async () => {
    const out = await tools.getConversation({ conversationId: 'conv1' });

    expect(messages.findByIdForAdmin).toHaveBeenLastCalledWith('conv1', 'c1');
    expect(out).toEqual(
      expect.objectContaining({
        id: 'conv1',
        messages: [{ body: '<p>hi</p>', format: 'HTML' }],
      }),
    );
  });

  it('masks shareholder participants in conversation details when canViewPII is false', async () => {
    perms.permissions.mockResolvedValue({ canManageMessages: true, canViewPII: false });
    messages.findByIdForAdmin.mockResolvedValue({
      id: 'conv1',
      participants: [
        {
          shareholder: {
            id: 'shareholder-1234',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
          },
        },
      ],
    });

    const result = await tools.getConversation({ conversationId: 'conv1' });

    expect(result).toEqual({
      id: 'conv1',
      participants: [
        {
          shareholder: expect.objectContaining({
            firstName: 'Aandeelhouder #1234',
            lastName: '',
            email: '***',
          }),
        },
      ],
    });
  });

  it('masks shareholder participants in conversation lists when canViewPII is false', async () => {
    perms.permissions.mockResolvedValue({ canManageMessages: true, canViewPII: false });
    messages.findAllForCoop.mockResolvedValue({
      conversations: [
        {
          id: 'conv1',
          participants: [
            { shareholder: { id: 'shareholder-1234', firstName: 'Ada', lastName: 'Lovelace' } },
          ],
        },
      ],
      total: 1,
      page: 1,
      totalPages: 1,
    });

    const result = await tools.listConversations({});

    expect(result).toEqual({
      conversations: [
        {
          id: 'conv1',
          participants: [
            {
              shareholder: expect.objectContaining({
                firstName: 'Aandeelhouder #1234',
                lastName: '',
              }),
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      totalPages: 1,
    });
  });

  it('previews an audience after resolving a project name', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1', name: 'Onze Energie: Northwind' });

    await expect(
      tools.previewMessageAudience({
        type: 'PROJECT',
        projectName: 'Onze Energie: Northwind',
      }),
    ).resolves.toEqual({ count: 2 });

    expect(audienceService.resolve).toHaveBeenCalledWith('c1', {
      type: 'PROJECT',
      projectId: 'p1',
    });
  });

  it('sends a draft with the authenticated coop and audit context', async () => {
    await tools.sendMessageDraft({ conversationId: 'conv1' });

    expect(messages.send).toHaveBeenCalledWith('conv1', 'c1', {
      userId: 'u1',
      ip: 'mcp',
      userAgent: 'mcp-api-key:k1',
    });
  });

  it('schedules a draft with a parsed date and authenticated user', async () => {
    await tools.scheduleMessageDraft({
      conversationId: 'conv1',
      scheduledAt: '2026-09-25T12:00:00.000Z',
    });

    expect(messages.schedule).toHaveBeenCalledWith(
      'conv1',
      'c1',
      new Date('2026-09-25T12:00:00.000Z'),
      'u1',
    );
  });

  it('unschedules a draft with the authenticated coop and user', async () => {
    await tools.unscheduleMessageDraft({ conversationId: 'conv1' });

    expect(messages.cancelSchedule).toHaveBeenCalledWith('conv1', 'c1', 'u1');
  });

  it('replies to a conversation with validated message data', async () => {
    await tools.replyToConversation({
      conversationId: 'conv1',
      body: 'Bedankt voor uw bericht.',
      existingDocumentIds: ['document1'],
    });

    expect(messages.addAdminReply).toHaveBeenCalledWith(
      'conv1',
      'c1',
      { body: 'Bedankt voor uw bericht.', existingDocumentIds: ['document1'] },
      'u1',
    );
  });

  it('rejects send_message_draft for read-only keys and missing permission', async () => {
    auth.getScope.mockReturnValue('READ_ONLY');
    await expect(tools.sendMessageDraft({ conversationId: 'conv1' })).rejects.toMatchObject({
      message: 'This API key is read-only',
    });
    expect(messages.send).not.toHaveBeenCalled();

    auth.getScope.mockReturnValue('READ_WRITE');
    perms.permissions.mockResolvedValue({ canViewPII: true });
    await expect(tools.sendMessageDraft({ conversationId: 'conv1' })).rejects.toMatchObject({
      message: 'Insufficient permissions',
    });
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('rejects create_conversation for read-only keys and missing permission', async () => {
    auth.getScope.mockReturnValue('READ_ONLY');
    await expect(
      tools.createConversation({
        subject: 'S',
        type: 'DIRECT',
        body: 'Hello shareholder.',
        shareholderId: 'shareholder1',
      }),
    ).rejects.toMatchObject({ message: 'This API key is read-only' });
    expect(messages.createConversation).not.toHaveBeenCalled();

    auth.getScope.mockReturnValue('READ_WRITE');
    perms.permissions.mockResolvedValue({ canViewPII: true });
    await expect(
      tools.createConversation({
        subject: 'S',
        type: 'DIRECT',
        body: 'Hello shareholder.',
        shareholderId: 'shareholder1',
      }),
    ).rejects.toMatchObject({ message: 'Insufficient permissions' });
    expect(messages.createConversation).not.toHaveBeenCalled();
  });

  it('rejects invalid new tool inputs through their zod schemas', () => {
    expect(listConversationsParameters.safeParse({ page: 0 }).success).toBe(false);
    expect(
      getConversationParameters.safeParse({ conversationId: 'conv1', extra: true }).success,
    ).toBe(false);
    expect(audienceSchema.safeParse({ type: 'ALL', unexpected: true }).success).toBe(false);
    expect(
      createConversationParameters.safeParse({
        subject: 'S',
        type: 'BROADCAST',
        body: 'Hello shareholders.',
        audience: { type: 'ALL', projectName: 'x' },
      }).success,
    ).toBe(false);
    expect(sendMessageDraftParameters.safeParse({ conversationId: 1 }).success).toBe(false);
    expect(
      scheduleMessageDraftParameters.safeParse({
        conversationId: 'conv1',
        scheduledAt: '2026-09-25T12:00:00.000',
      }).success,
    ).toBe(false);
    expect(
      unscheduleMessageDraftParameters.safeParse({ conversationId: 'conv1', extra: true }).success,
    ).toBe(false);
    expect(
      replyToConversationParameters.safeParse({ conversationId: 'conv1', body: '' }).success,
    ).toBe(false);
  });

  it('returns the toolkit error shape for denied reads', async () => {
    perms.permissions.mockResolvedValue({});

    await expect(tools.getMessageDraft({ conversationId: 'conv1' })).rejects.toBeInstanceOf(
      McpError,
    );
  });
});
