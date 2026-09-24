import { Test } from '@nestjs/testing';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { PrismaService } from '../../../prisma/prisma.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import { MessagesService } from '../../messages/messages.service';
import { McpMessageTools } from './mcp-message.tools';

describe('McpMessageTools', () => {
  let tools: McpMessageTools;
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'c1',
    getApiKeyId: () => 'k1',
    getScope: () => 'READ_WRITE' as const,
  };
  const messages = {
    createConversation: jest.fn(),
    updateDraft: jest.fn(),
    findByIdForAdmin: jest.fn(),
    countRecipients: jest.fn(),
  };
  const perms = { permissions: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const prisma = { project: { findFirst: jest.fn() } };

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
      ],
    }).compile();
    tools = module.get(McpMessageTools);
    jest.clearAllMocks();
    perms.permissions.mockResolvedValue({ canManageMessages: true, canViewPII: true });
    billing.isReadOnly.mockResolvedValue(false);
    messages.createConversation.mockResolvedValue({ id: 'conv1' });
    messages.updateDraft.mockResolvedValue({});
    messages.countRecipients.mockResolvedValue(62);
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

  it('returns the toolkit error shape for denied reads', async () => {
    perms.permissions.mockResolvedValue({});

    await expect(tools.getMessageDraft({ conversationId: 'conv1' })).rejects.toBeInstanceOf(
      McpError,
    );
  });
});
