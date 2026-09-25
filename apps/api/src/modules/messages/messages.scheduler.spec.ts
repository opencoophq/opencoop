import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { MessagesScheduler } from './messages.scheduler';
import { MessagesService } from './messages.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';

describe('MessagesScheduler', () => {
  let scheduler: MessagesScheduler;
  const prisma = {
    conversation: { findMany: jest.fn(), update: jest.fn() },
    coopAdmin: { findMany: jest.fn() },
    coop: { findUnique: jest.fn() },
  };
  const messages = { send: jest.fn() };
  const email = { send: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MessagesScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: MessagesService, useValue: messages },
        { provide: EmailService, useValue: email },
      ],
    }).compile();
    scheduler = module.get(MessagesScheduler);
    jest.clearAllMocks();
  });

  it('sends every due scheduled conversation with the scheduling user as actor', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      { id: 'a', coopId: 'c', createdById: 'u1', subject: 'A', sendAttempts: 0 },
      { id: 'b', coopId: 'c', createdById: 'u2', subject: 'B', sendAttempts: 0 },
    ]);
    await scheduler.tick();
    expect(prisma.conversation.findMany).toHaveBeenCalledWith({
      where: { status: 'SCHEDULED', scheduledAt: { lte: expect.any(Date) } },
      orderBy: { scheduledAt: 'asc' },
      select: { id: true, coopId: true, createdById: true, subject: true, sendAttempts: true },
    });
    const scheduledBefore = prisma.conversation.findMany.mock.calls[0][0].where.scheduledAt.lte;
    expect(messages.send).toHaveBeenCalledWith('a', 'c', { userId: 'u1' }, { scheduledBefore });
    expect(messages.send).toHaveBeenCalledWith('b', 'c', { userId: 'u2' }, { scheduledBefore });
  });

  it('counts a failure and leaves the row scheduled', async () => {
    prisma.conversation.findMany.mockResolvedValue([{ id: 'a', coopId: 'c', createdById: 'u1', subject: 'A', sendAttempts: 0 }]);
    messages.send.mockRejectedValueOnce(new Error('smtp down'));
    await scheduler.tick();
    expect(prisma.conversation.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { sendAttempts: 1 } });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('flips back to draft after the third failure and mails the admins', async () => {
    prisma.conversation.findMany.mockResolvedValue([{ id: 'a', coopId: 'c', createdById: 'u1', subject: 'A', sendAttempts: 2 }]);
    messages.send.mockRejectedValueOnce(new Error('smtp down'));
    prisma.coop.findUnique.mockResolvedValue({ name: 'Coop', emailEnabled: true });
    prisma.coopAdmin.findMany.mockResolvedValue([{ user: { email: 'admin@x.be', name: 'Admin' } }]);
    await scheduler.tick();
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { status: 'DRAFT', scheduledAt: null, sendAttempts: 3 },
    });
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@x.be',
        templateKey: 'admin-message-notification',
        templateData: expect.objectContaining({ adminName: 'Admin', messageSubject: 'A' }),
      }),
    );
  });

  it('skips a conversation cancelled or rescheduled after the due snapshot', async () => {
    prisma.conversation.findMany.mockResolvedValue([{ id: 'a', coopId: 'c', createdById: 'u1', subject: 'A', sendAttempts: 2 }]);
    messages.send.mockRejectedValueOnce(new ConflictException('Conversation is no longer due'));
    await scheduler.tick();
    const scheduledBefore = prisma.conversation.findMany.mock.calls[0][0].where.scheduledAt.lte;
    expect(messages.send).toHaveBeenCalledWith('a', 'c', { userId: 'u1' }, { scheduledBefore });
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('keeps going when one conversation fails', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      { id: 'a', coopId: 'c', createdById: 'u1', subject: 'A', sendAttempts: 0 },
      { id: 'b', coopId: 'c', createdById: 'u1', subject: 'B', sendAttempts: 0 },
    ]);
    messages.send.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({});
    await scheduler.tick();
    expect(messages.send).toHaveBeenCalledTimes(2);
  });
});
