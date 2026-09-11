import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { McpMessageTools } from './mcp-message.tools';
import { McpAuthStore } from '../mcp-auth.store';
import { MessagesService } from '../../messages/messages.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { PrismaService } from '../../../prisma/prisma.service';

describe('McpMessageTools', () => {
  let tools: McpMessageTools;
  const auth = { getUserId: () => 'u1', getCoopId: () => 'c1', getApiKeyId: () => 'k1' };
  const messages = {
    createConversation: jest.fn(),
    updateDraft: jest.fn(),
    findByIdForAdmin: jest.fn(),
    countRecipients: jest.fn(),
  };
  const perms = { has: jest.fn() };
  const prisma = { project: { findFirst: jest.fn() } };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpMessageTools,
        { provide: McpAuthStore, useValue: auth },
        { provide: MessagesService, useValue: messages },
        { provide: CoopPermissionsService, useValue: perms },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    tools = module.get(McpMessageTools);
    jest.clearAllMocks();
    perms.has.mockResolvedValue(true);
    messages.createConversation.mockResolvedValue({ id: 'conv1' });
    messages.countRecipients.mockResolvedValue(62);
    messages.findByIdForAdmin.mockResolvedValue({
      id: 'conv1', subject: 'S', status: 'DRAFT', audienceType: 'PROJECT', audienceProjectId: 'p1', audienceShareholderIds: [],
      messages: [{ body: '<p>hi</p>', format: 'HTML' }],
    });
  });

  it('creates a DRAFT from markdown for a project audience by name', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1', name: 'Onze Energie: Northwind' });
    const out = JSON.parse(await tools.createMessageDraft({
      subject: 'S', bodyMarkdown: '## Kop\n\nTekst **vet**.', audience: { type: 'PROJECT', projectName: 'Onze Energie: Northwind' },
    }));
    expect(messages.createConversation).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ type: 'BROADCAST', status: 'DRAFT', format: 'HTML', subject: 'S', body: '<h2>Kop</h2>\n<p>Tekst <strong>vet</strong>.</p>', audience: { type: 'PROJECT', projectId: 'p1' } }),
      'u1', undefined, 'mcp', { apiKeyId: 'k1' },
    );
    expect(out).toEqual(expect.objectContaining({ id: 'conv1', status: 'DRAFT', recipientCount: 62 }));
    expect(out.adminUrl).toMatch(/\/dashboard\/admin\/messages\/conv1$/);
  });

  it('refuses without canManageMessages', async () => {
    perms.has.mockResolvedValue(false);
    await expect(tools.createMessageDraft({ subject: 'S', bodyMarkdown: 'x', audience: { type: 'ALL' } })).rejects.toThrow(ForbiddenException);
    expect(messages.createConversation).not.toHaveBeenCalled();
  });

  it('never passes a status other than DRAFT', async () => {
    await tools.createMessageDraft({ subject: 'S', bodyMarkdown: 'x', audience: { type: 'ALL' } });
    const dto = messages.createConversation.mock.calls[0][1];
    expect(dto.status).toBe('DRAFT');
  });

  it('updates a draft body from markdown', async () => {
    messages.updateDraft.mockResolvedValue({});
    await tools.updateMessageDraft({ conversationId: 'conv1', bodyMarkdown: 'nieuw' });
    expect(messages.updateDraft).toHaveBeenCalledWith('conv1', 'c1', { body: '<p>nieuw</p>', format: 'HTML' }, 'u1');
  });

  it('get returns status, html, audience, count and admin url', async () => {
    const out = JSON.parse(await tools.getMessageDraft({ conversationId: 'conv1' }));
    expect(out).toEqual(expect.objectContaining({ id: 'conv1', status: 'DRAFT', bodyHtml: '<p>hi</p>', recipientCount: 62, audience: { type: 'PROJECT', projectId: 'p1', shareholderIds: [] } }));
  });
});
