import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { AudienceService } from './audience.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';

describe('MessagesService drafts and sending', () => {
  let service: MessagesService;

  const tx = {
    conversation: { create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    message: { create: jest.fn() },
    messageAttachment: { createMany: jest.fn() },
    conversationParticipant: { createMany: jest.fn(), create: jest.fn() },
    shareholder: { findMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    conversation: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), delete: jest.fn() },
    coop: { findUnique: jest.fn() },
    message: { findFirst: jest.fn(), update: jest.fn() },
  };
  const audience = { resolve: jest.fn() };
  const audit = { log: jest.fn() };
  const email = { send: jest.fn() };

  const actor = { userId: 'u1', ip: '127.0.0.1', userAgent: 'jest' };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AudienceService, useValue: audience },
        { provide: AuditService, useValue: audit },
        { provide: EmailService, useValue: email },
      ],
    }).compile();
    service = module.get(MessagesService);
    jest.clearAllMocks();
    tx.conversation.create.mockImplementation(async ({ data }) => ({ id: 'c1', ...data }));
    tx.message.create.mockResolvedValue({ id: 'm1' });
    tx.conversation.updateMany.mockResolvedValue({ count: 1 });
    prisma.coop.findUnique.mockResolvedValue({ name: 'Coop', slug: 'coop', emailEnabled: true });
  });

  describe('createConversation', () => {
    it('creates a DRAFT broadcast with a project audience and no participants', async () => {
      const conv = await service.createConversation(
        'coop1',
        { type: 'BROADCAST', subject: 'S', body: '<p>hi</p><script>x</script>', status: 'DRAFT', audience: { type: 'PROJECT', projectId: 'p1' } },
        'u1',
      );
      expect(conv.id).toBe('c1');
      expect(tx.conversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'DRAFT', audienceType: 'PROJECT', audienceProjectId: 'p1', audienceShareholderIds: [] }),
      });
      expect(tx.message.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ body: '<p>hi</p>', format: 'HTML', senderType: 'ADMIN' }),
      });
      expect(tx.conversationParticipant.createMany).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('defaults to SENT + ALL for a plain broadcast and sends immediately', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: ['s1', 's2'] });
      prisma.conversation.findUnique
        .mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'DRAFT', audienceType: 'ALL', audienceProjectId: null, audienceShareholderIds: [] })
        .mockResolvedValueOnce({ id: 'c1', subject: 'S', participants: [], messages: [{ body: '<p>hi</p>', format: 'HTML' }] });
      await service.createConversation('coop1', { type: 'BROADCAST', subject: 'S', body: '<p>hi</p>' }, 'u1');
      expect(tx.conversationParticipant.createMany).toHaveBeenCalledWith({
        data: [{ conversationId: 'c1', shareholderId: 's1' }, { conversationId: 'c1', shareholderId: 's2' }],
        skipDuplicates: true,
      });
      expect(tx.conversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1', status: { in: ['DRAFT', 'SCHEDULED'] } } }),
      );
    });

    it('maps a DIRECT conversation to a SELECTED audience of one', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: ['s9'] });
      prisma.conversation.findUnique
        .mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'DRAFT', audienceType: 'SELECTED', audienceProjectId: null, audienceShareholderIds: ['s9'] })
        .mockResolvedValueOnce({ id: 'c1', subject: 'S', participants: [], messages: [] });
      await service.createConversation('coop1', { type: 'DIRECT', subject: 'S', body: 'hi', shareholderId: 's9', format: 'TEXT' }, 'u1');
      expect(tx.conversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'DIRECT', audienceType: 'SELECTED', audienceShareholderIds: ['s9'] }),
      });
    });

    it('records the api key that created a draft', async () => {
      await service.createConversation('coop1', { type: 'BROADCAST', subject: 'S', body: 'x', status: 'DRAFT' }, 'u1', undefined, undefined, { apiKeyId: 'k1' });
      expect(tx.conversation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ createdByApiKeyId: 'k1' }) });
    });
  });

  describe('send', () => {
    const draft = { id: 'c1', coopId: 'coop1', status: 'DRAFT', audienceType: 'ALL', audienceProjectId: null, audienceShareholderIds: [] };

    it('creates participants, marks SENT, queues one email per participant, logs audit', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: ['s1', 's2'] });
      prisma.conversation.findUnique
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce({
          id: 'c1', subject: 'S',
          participants: [
            { shareholder: { email: 'a@x.be', firstName: 'A', user: null } },
            { shareholder: { email: 'b@x.be', firstName: 'B', user: { preferredLanguage: 'fr', email: 'b@x.be' } } },
          ],
          messages: [{ body: '<p>hi</p>', format: 'HTML', attachments: [] }],
        });
      await service.send('c1', 'coop1', actor);
      expect(tx.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', status: { in: ['DRAFT', 'SCHEDULED'] } },
        data: expect.objectContaining({ status: 'SENT', scheduledAt: null }),
      });
      expect(tx.conversationParticipant.createMany).toHaveBeenCalledTimes(1);
      expect(email.send).toHaveBeenCalledTimes(2);
      expect(email.send).toHaveBeenLastCalledWith(
        expect.objectContaining({
          to: 'b@x.be',
          templateKey: 'message-notification',
          templateData: expect.objectContaining({ messageBody: '<p>hi</p>', language: 'fr', hasAttachments: false }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'Conversation', entityId: 'c1', action: 'UPDATE', actorId: 'u1' }),
      );
    });

    it('refuses an already sent conversation', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ ...draft, status: 'SENT' });
      await expect(service.send('c1', 'coop1', actor)).rejects.toThrow(ConflictException);
    });

    it('refuses when the guarded update claims nothing (concurrent send)', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: ['s1'] });
      prisma.conversation.findUnique.mockResolvedValueOnce(draft);
      tx.conversation.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.send('c1', 'coop1', actor)).rejects.toThrow(ConflictException);
      expect(tx.conversationParticipant.createMany).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('refuses an empty audience', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: [] });
      prisma.conversation.findUnique.mockResolvedValueOnce(draft);
      await expect(service.send('c1', 'coop1', actor)).rejects.toThrow(BadRequestException);
    });

    it('is a 404 for another coop', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ ...draft, coopId: 'other' });
      await expect(service.send('c1', 'coop1', actor)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateDraft / deleteDraft', () => {
    it('sanitises the body and updates the audience of a draft', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'DRAFT' });
      prisma.message.findFirst.mockResolvedValueOnce({ id: 'm1' });
      await service.updateDraft('c1', 'coop1', { body: '<p>a</p><img src=x>', audience: { type: 'SELECTED', shareholderIds: ['s1'] } }, 'u1');
      expect(prisma.message.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { body: '<p>a</p>', format: 'HTML' } });
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: expect.objectContaining({ audienceType: 'SELECTED', audienceShareholderIds: ['s1'], audienceProjectId: null }),
      });
    });

    it('refuses to update or delete a sent conversation', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ id: 'c1', coopId: 'coop1', status: 'SENT' });
      await expect(service.updateDraft('c1', 'coop1', { subject: 'x' }, 'u1')).rejects.toThrow(ConflictException);
      await expect(service.deleteDraft('c1', 'coop1', 'u1')).rejects.toThrow(ConflictException);
    });

    it('deletes a draft', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'DRAFT' });
      await service.deleteDraft('c1', 'coop1', 'u1');
      expect(prisma.conversation.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });
  });

  describe('schedule / cancelSchedule', () => {
    it('schedules a draft in the future', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'DRAFT' });
      const at = new Date(Date.now() + 10 * 60_000);
      await service.schedule('c1', 'coop1', at, 'u1');
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'SCHEDULED', scheduledAt: at, sendAttempts: 0 },
      });
    });

    it('rejects a time less than a minute ahead', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'DRAFT' });
      await expect(service.schedule('c1', 'coop1', new Date(Date.now() + 10_000), 'u1')).rejects.toThrow(BadRequestException);
    });

    it('cancels back to draft', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'SCHEDULED' });
      await service.cancelSchedule('c1', 'coop1', 'u1');
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'DRAFT', scheduledAt: null },
      });
    });

    it('cannot cancel a draft or a sent conversation', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'SENT' });
      await expect(service.cancelSchedule('c1', 'coop1', 'u1')).rejects.toThrow(ConflictException);
    });
  });

  describe('findAllForCoop', () => {
    it('adds recipientCount: participants for sent, resolved audience for drafts', async () => {
      prisma.conversation.findMany.mockResolvedValue([
        { id: 'a', status: 'SENT', _count: { participants: 5, messages: 1 }, audienceType: 'ALL', audienceProjectId: null, audienceShareholderIds: [] },
        { id: 'b', status: 'DRAFT', _count: { participants: 0, messages: 1 }, audienceType: 'SELECTED', audienceProjectId: null, audienceShareholderIds: ['s1', 's2'] },
      ]);
      prisma.conversation.count.mockResolvedValue(2);
      audience.resolve.mockResolvedValue({ shareholderIds: ['s1', 's2'] });
      const r = await service.findAllForCoop('coop1', 1);
      expect(r.conversations.map((c) => c.recipientCount)).toEqual([5, 2]);
      expect(audience.resolve).toHaveBeenCalledTimes(1);
    });
  });
});
