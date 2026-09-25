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
    conversation: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    coop: { findUnique: jest.fn() },
    message: { findFirst: jest.fn(), update: jest.fn() },
  };
  const audience = {
    resolve: jest.fn(),
    count: jest.fn(),
    assertProjectBelongsToCoop: jest.fn(),
  };
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
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
    tx.conversation.create.mockImplementation(async ({ data }) => ({ id: 'c1', ...data }));
    tx.message.create.mockResolvedValue({ id: 'm1' });
    tx.conversation.updateMany.mockResolvedValue({ count: 1 });
    prisma.coop.findUnique.mockResolvedValue({ name: 'Coop', slug: 'coop', emailEnabled: true });
    audience.assertProjectBelongsToCoop.mockResolvedValue(undefined);
  });

  describe('createConversation', () => {
    it('defaults an omitted format to TEXT without sanitising the body', async () => {
      const conv = await service.createConversation(
        'coop1',
        {
          type: 'BROADCAST',
          subject: 'S',
          body: '<p>hi</p><script>x</script>',
          status: 'DRAFT',
          audience: { type: 'PROJECT', projectId: 'p1' },
        },
        'u1',
      );
      expect(conv.id).toBe('c1');
      expect(tx.conversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'DRAFT',
          audienceType: 'PROJECT',
          audienceProjectId: 'p1',
          audienceShareholderIds: [],
        }),
      });
      expect(tx.message.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          body: '<p>hi</p><script>x</script>',
          format: 'TEXT',
          senderType: 'ADMIN',
        }),
      });
      expect(tx.conversationParticipant.createMany).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('defaults to SENT + ALL for a plain broadcast and sends immediately', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: ['s1', 's2'] });
      prisma.conversation.findUnique
        .mockResolvedValueOnce({
          id: 'c1',
          coopId: 'coop1',
          status: 'DRAFT',
          audienceType: 'ALL',
          audienceProjectId: null,
          audienceShareholderIds: [],
        })
        .mockResolvedValueOnce({
          id: 'c1',
          subject: 'S',
          participants: [],
          messages: [{ body: '<p>hi</p>', format: 'HTML' }],
        });
      await service.createConversation(
        'coop1',
        { type: 'BROADCAST', subject: 'S', body: '<p>hi</p>' },
        'u1',
      );
      expect(tx.conversationParticipant.createMany).toHaveBeenCalledWith({
        data: [
          { conversationId: 'c1', shareholderId: 's1' },
          { conversationId: 'c1', shareholderId: 's2' },
        ],
        skipDuplicates: true,
      });
      expect(tx.conversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1', status: { in: ['DRAFT', 'SCHEDULED'] } } }),
      );
    });

    it('maps a DIRECT conversation to a SELECTED audience of one', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: ['s9'] });
      prisma.conversation.findUnique
        .mockResolvedValueOnce({
          id: 'c1',
          coopId: 'coop1',
          status: 'DRAFT',
          audienceType: 'SELECTED',
          audienceProjectId: null,
          audienceShareholderIds: ['s9'],
        })
        .mockResolvedValueOnce({ id: 'c1', subject: 'S', participants: [], messages: [] });
      await service.createConversation(
        'coop1',
        { type: 'DIRECT', subject: 'S', body: 'hi', shareholderId: 's9', format: 'TEXT' },
        'u1',
      );
      expect(tx.conversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'DIRECT',
          audienceType: 'SELECTED',
          audienceShareholderIds: ['s9'],
        }),
      });
    });

    it('records the api key that created a draft', async () => {
      await service.createConversation(
        'coop1',
        { type: 'BROADCAST', subject: 'S', body: 'x', status: 'DRAFT' },
        'u1',
        undefined,
        undefined,
        { apiKeyId: 'k1' },
      );
      expect(tx.conversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ createdByApiKeyId: 'k1' }),
      });
    });

    it('creates no rows or SENT audit when immediate-send audience validation fails', async () => {
      audience.resolve.mockRejectedValueOnce(new BadRequestException({ code: 'EMPTY_AUDIENCE' }));
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        type: 'BROADCAST',
        status: 'DRAFT',
        audienceType: 'ALL',
        audienceProjectId: null,
        audienceShareholderIds: [],
      });

      await expect(
        service.createConversation('coop1', { type: 'BROADCAST', subject: 'S', body: 'x' }, 'u1'),
      ).rejects.toThrow(BadRequestException);

      expect(tx.conversation.create).not.toHaveBeenCalled();
      expect(tx.message.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.arrayContaining([
            expect.objectContaining({ field: 'status', newValue: 'SENT' }),
          ]),
        }),
      );
    });

    it('rejects a draft PROJECT audience from another coop before creating rows', async () => {
      audience.assertProjectBelongsToCoop.mockRejectedValueOnce(
        new NotFoundException('Project not found'),
      );

      await expect(
        service.createConversation(
          'coop1',
          {
            type: 'BROADCAST',
            subject: 'S',
            body: 'x',
            status: 'DRAFT',
            audience: { type: 'PROJECT', projectId: 'foreign-project' },
          },
          'u1',
        ),
      ).rejects.toThrow('Project not found');

      expect(audience.assertProjectBelongsToCoop).toHaveBeenCalledWith('coop1', 'foreign-project');
      expect(tx.conversation.create).not.toHaveBeenCalled();
      expect(tx.message.create).not.toHaveBeenCalled();
    });

    it('deletes an immediate-send conversation when send fails before claiming it', async () => {
      const sendError = new Error('claim failed');
      audience.resolve.mockResolvedValueOnce({ shareholderIds: ['s1'] });
      prisma.conversation.findUnique
        .mockRejectedValueOnce(sendError)
        .mockResolvedValueOnce({ id: 'c1', status: 'DRAFT' });

      await expect(
        service.createConversation(
          'coop1',
          { type: 'BROADCAST', subject: 'S', body: 'x' },
          'u1',
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toBe(sendError);

      expect(prisma.conversation.findUnique).toHaveBeenLastCalledWith({
        where: { id: 'c1' },
        select: { status: true },
      });
      expect(prisma.conversation.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('returns an immediate-send conversation and audits SENT when send fails after claiming it', async () => {
      const sendError = new Error('smtp down');
      audience.resolve.mockResolvedValueOnce({ shareholderIds: ['s1'] });
      jest.spyOn(service, 'send').mockRejectedValueOnce(sendError);
      prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', status: 'SENT' });

      await expect(
        service.createConversation(
          'coop1',
          { type: 'BROADCAST', subject: 'S', body: 'x' },
          'u1',
          '127.0.0.1',
          'jest',
        ),
      ).resolves.toEqual(expect.objectContaining({ id: 'c1' }));

      expect(prisma.conversation.delete).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith({
        coopId: 'coop1',
        entity: 'Conversation',
        entityId: 'c1',
        action: 'CREATE',
        changes: [
          { field: 'type', oldValue: null, newValue: 'BROADCAST' },
          { field: 'status', oldValue: null, newValue: 'SENT' },
        ],
        actorId: 'u1',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      });
    });
  });

  describe('addAdminReply', () => {
    it('stores multiline admin replies as TEXT', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        status: 'SENT',
      });

      await service.addAdminReply('c1', 'coop1', { body: 'first line\nsecond line' }, 'u1');

      expect(tx.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'c1',
          senderType: 'ADMIN',
          senderId: 'u1',
          body: 'first line\nsecond line',
          format: 'TEXT',
        },
      });
    });

    it.each(['DRAFT', 'SCHEDULED'] as const)(
      'rejects an admin reply to a %s conversation',
      async (status) => {
        prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status });

        await expect(service.addAdminReply('c1', 'coop1', { body: 'reply' }, 'u1')).rejects.toThrow(
          new BadRequestException(
            'Only sent conversations can be replied to; edit the draft instead',
          ),
        );

        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );
  });

  describe('send', () => {
    const draft = {
      id: 'c1',
      coopId: 'coop1',
      status: 'DRAFT',
      audienceType: 'ALL',
      audienceProjectId: null,
      audienceShareholderIds: [],
    };

    it('creates participants, marks SENT, queues one email per participant, logs audit', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: ['s1', 's2'] });
      prisma.conversation.findUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce({
        id: 'c1',
        subject: 'S',
        participants: [
          { shareholder: { email: 'a@x.be', firstName: 'A', user: null } },
          {
            shareholder: {
              email: 'b@x.be',
              firstName: 'B',
              user: { preferredLanguage: 'fr', email: 'b@x.be' },
            },
          },
        ],
        messages: [{ body: '<p>hi</p>', format: 'HTML', attachments: [] }],
      });
      await expect(service.send('c1', 'coop1', actor)).resolves.toEqual(
        expect.objectContaining({ notificationFailures: 0 }),
      );
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
          templateData: expect.objectContaining({
            messageBody: '<p>hi</p>',
            language: 'fr',
            hasAttachments: false,
          }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Conversation',
          entityId: 'c1',
          action: 'UPDATE',
          actorId: 'u1',
        }),
      );
    });

    it('keeps the claim and records a notification failure without throwing', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: ['s1'] });
      prisma.conversation.findUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce({
        id: 'c1',
        subject: 'S',
        participants: [{ shareholder: { email: 'a@x.be', firstName: 'A', user: null } }],
        messages: [{ body: 'hello', format: 'TEXT', attachments: [] }],
      });
      email.send.mockRejectedValueOnce(new Error('smtp down'));

      await expect(service.send('c1', 'coop1', actor)).resolves.toEqual(
        expect.objectContaining({
          id: 'c1',
          status: 'SENT',
          recipientCount: 1,
          notificationFailures: 1,
        }),
      );

      expect(tx.conversationParticipant.createMany).toHaveBeenCalledWith({
        data: [{ conversationId: 'c1', shareholderId: 's1' }],
        skipDuplicates: true,
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          coopId: 'coop1',
          entity: 'Conversation',
          entityId: 'c1',
          action: 'UPDATE',
          changes: [{ field: 'notifyFailure', oldValue: null, newValue: 'smtp down' }],
          actorId: 'u1',
        }),
      );
    });

    it('resolves a DIRECT recipient without the SELECTED broadcast filter', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: ['s-pending'] });
      prisma.conversation.findUnique
        .mockResolvedValueOnce({
          id: 'c1',
          coopId: 'coop1',
          type: 'DIRECT',
          status: 'DRAFT',
          audienceType: 'SELECTED',
          audienceProjectId: null,
          audienceShareholderIds: ['s-pending'],
        })
        .mockResolvedValueOnce(null);

      await service.send('c1', 'coop1', actor);

      expect(audience.resolve).toHaveBeenCalledWith('coop1', {
        type: 'DIRECT',
        shareholderId: 's-pending',
      });
      expect(tx.conversationParticipant.createMany).toHaveBeenCalledWith({
        data: [{ conversationId: 'c1', shareholderId: 's-pending' }],
        skipDuplicates: true,
      });
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

    it('uses a due-only atomic claim for scheduler sends', async () => {
      const scheduledBefore = new Date('2026-09-25T12:00:00.000Z');
      audience.resolve.mockResolvedValue({ shareholderIds: ['s1'] });
      prisma.conversation.findUnique.mockResolvedValueOnce({
        ...draft,
        type: 'BROADCAST',
        status: 'SCHEDULED',
      });
      tx.conversation.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.send('c1', 'coop1', actor, { scheduledBefore })).rejects.toThrow(
        ConflictException,
      );

      expect(tx.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', status: 'SCHEDULED', scheduledAt: { lte: scheduledBefore } },
        data: expect.objectContaining({ status: 'SENT', scheduledAt: null }),
      });
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
    it('rejects every audience edit on a direct draft before updating it', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        type: 'DIRECT',
        status: 'DRAFT',
      });

      await expect(
        service.updateDraft('c1', 'coop1', { audience: { type: 'ALL' } }, 'u1'),
      ).rejects.toThrow(new BadRequestException("A direct message's recipient cannot be changed"));

      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('still updates non-audience fields on a direct draft', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        type: 'DIRECT',
        status: 'DRAFT',
      });

      await service.updateDraft('c1', 'coop1', { subject: 'New subject' }, 'u1');

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: expect.objectContaining({ subject: 'New subject' }),
      });
    });

    it('still updates the audience on a broadcast draft', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        type: 'BROADCAST',
        status: 'DRAFT',
      });

      await service.updateDraft(
        'c1',
        'coop1',
        { audience: { type: 'SELECTED', shareholderIds: ['s1'] } },
        'u1',
      );

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: expect.objectContaining({
          audienceType: 'SELECTED',
          audienceProjectId: null,
          audienceShareholderIds: ['s1'],
        }),
      });
    });

    it('preserves the stored TEXT format during a body-only update', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        status: 'DRAFT',
      });
      prisma.message.findFirst.mockResolvedValueOnce({ id: 'm1', body: 'old', format: 'TEXT' });

      await service.updateDraft('c1', 'coop1', { body: 'first\nsecond<script>x</script>' }, 'u1');

      expect(prisma.message.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { body: 'first\nsecond<script>x</script>', format: 'TEXT' },
      });
    });

    it('sanitises the body and updates the audience of a draft', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        status: 'DRAFT',
      });
      prisma.message.findFirst.mockResolvedValueOnce({ id: 'm1', body: 'old', format: 'HTML' });
      await service.updateDraft(
        'c1',
        'coop1',
        {
          body: '<p>a</p><img src=x>',
          format: 'HTML',
          audience: { type: 'SELECTED', shareholderIds: ['s1'] },
        },
        'u1',
      );
      expect(prisma.message.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { body: '<p>a</p>', format: 'HTML' },
      });
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: expect.objectContaining({
          audienceType: 'SELECTED',
          audienceShareholderIds: ['s1'],
          audienceProjectId: null,
        }),
      });
    });

    it('updates only the format of a draft and keeps the body', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        status: 'DRAFT',
      });
      prisma.message.findFirst.mockResolvedValueOnce({
        id: 'm1',
        body: '<p>keep</p>',
        format: 'HTML',
      });
      await service.updateDraft('c1', 'coop1', { format: 'HTML' }, 'u1');
      expect(prisma.message.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { body: '<p>keep</p>', format: 'HTML' },
      });
    });

    it('refuses to update or delete a sent conversation', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'c1',
        coopId: 'coop1',
        status: 'SENT',
      });
      await expect(service.updateDraft('c1', 'coop1', { subject: 'x' }, 'u1')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.deleteDraft('c1', 'coop1', 'u1')).rejects.toThrow(ConflictException);
    });

    it('deletes a draft', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        status: 'DRAFT',
      });
      await service.deleteDraft('c1', 'coop1', 'u1');
      expect(prisma.conversation.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });

    it('rejects a PROJECT audience from another coop before changing the draft', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        status: 'DRAFT',
      });
      prisma.message.findFirst.mockResolvedValueOnce({ id: 'm1', body: 'old', format: 'TEXT' });
      audience.assertProjectBelongsToCoop.mockRejectedValueOnce(
        new NotFoundException('Project not found'),
      );

      await expect(
        service.updateDraft(
          'c1',
          'coop1',
          {
            body: 'new',
            audience: { type: 'PROJECT', projectId: 'foreign-project' },
          },
          'u1',
        ),
      ).rejects.toThrow('Project not found');

      expect(audience.assertProjectBelongsToCoop).toHaveBeenCalledWith('coop1', 'foreign-project');
      expect(prisma.message.update).not.toHaveBeenCalled();
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });
  });

  describe('schedule / cancelSchedule', () => {
    it('schedules a draft in the future', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        status: 'DRAFT',
      });
      const at = new Date(Date.now() + 10 * 60_000);
      await service.schedule('c1', 'coop1', at, 'u1');
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'SCHEDULED', scheduledAt: at, sendAttempts: 0 },
      });
    });

    it('rejects a time less than a minute ahead', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        status: 'DRAFT',
      });
      await expect(
        service.schedule('c1', 'coop1', new Date(Date.now() + 10_000), 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('cancels back to draft', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        status: 'SCHEDULED',
      });
      await service.cancelSchedule('c1', 'coop1', 'u1');
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'DRAFT', scheduledAt: null },
      });
    });

    it('cannot cancel a draft or a sent conversation', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        status: 'SENT',
      });
      await expect(service.cancelSchedule('c1', 'coop1', 'u1')).rejects.toThrow(ConflictException);
    });
  });

  describe('findAllForCoop', () => {
    it('adds recipientCount without resolving draft recipient ids', async () => {
      prisma.conversation.findMany.mockResolvedValue([
        {
          id: 'a',
          type: 'BROADCAST',
          status: 'SENT',
          _count: { participants: 5, messages: 1 },
          audienceType: 'ALL',
          audienceProjectId: null,
          audienceShareholderIds: [],
        },
        {
          id: 'b',
          type: 'BROADCAST',
          status: 'DRAFT',
          _count: { participants: 0, messages: 1 },
          audienceType: 'SELECTED',
          audienceProjectId: null,
          audienceShareholderIds: ['s1', 's2'],
        },
      ]);
      prisma.conversation.count.mockResolvedValue(2);
      audience.count.mockResolvedValue(2);
      const r = await service.findAllForCoop('coop1', 1);
      expect(r.conversations.map((c) => c.recipientCount)).toEqual([5, 2]);
      expect(audience.count).toHaveBeenCalledTimes(1);
      expect(audience.resolve).not.toHaveBeenCalled();
    });

    it('keeps valid rows when one draft audience cannot be counted', async () => {
      prisma.conversation.findMany.mockResolvedValue([
        {
          id: 'broken',
          type: 'BROADCAST',
          status: 'DRAFT',
          _count: { participants: 0, messages: 1 },
          audienceType: 'PROJECT',
          audienceProjectId: null,
          audienceShareholderIds: [],
        },
        {
          id: 'valid',
          type: 'BROADCAST',
          status: 'SCHEDULED',
          _count: { participants: 0, messages: 1 },
          audienceType: 'SELECTED',
          audienceProjectId: null,
          audienceShareholderIds: ['s1', 's2'],
        },
      ]);
      prisma.conversation.count.mockResolvedValue(2);
      audience.count
        .mockRejectedValueOnce(new BadRequestException('projectId is required'))
        .mockResolvedValueOnce(2);

      const result = await service.findAllForCoop('coop1', 1);

      expect(result.conversations.map((conversation) => conversation.recipientCount)).toEqual([
        null,
        2,
      ]);
      expect(audience.count).toHaveBeenCalledTimes(2);
    });

    it('counts a draft DIRECT recipient through the DIRECT audience variant', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c1',
        coopId: 'coop1',
        type: 'DIRECT',
        status: 'DRAFT',
        audienceType: 'SELECTED',
        audienceProjectId: null,
        audienceShareholderIds: ['s-pending'],
      });
      audience.count.mockResolvedValue(1);

      await expect(service.countRecipients('c1', 'coop1')).resolves.toBe(1);

      expect(audience.count).toHaveBeenCalledWith('coop1', {
        type: 'DIRECT',
        shareholderId: 's-pending',
      });
      expect(audience.resolve).not.toHaveBeenCalled();
    });
  });
});
