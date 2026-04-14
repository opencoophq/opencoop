import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConvocationService } from './convocation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';

describe('ConvocationService', () => {
  let service: ConvocationService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      meeting: { findUnique: jest.fn(), update: jest.fn() },
      shareholder: { findMany: jest.fn() },
      meetingAttendance: { upsert: jest.fn(), findMany: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConvocationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { send: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(ConvocationService);
  });

  it('rejects convocation less than 15 days before meeting without override', async () => {
    const scheduledAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    prisma.meeting.findUnique.mockResolvedValue({
      id: 'm1',
      coopId: 'c1',
      status: 'DRAFT',
      scheduledAt,
      agendaItems: [],
      coop: { name: 'Co' },
    });
    await expect(service.send('c1', 'm1', { confirmShortNotice: false })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('allows short notice if confirmed', async () => {
    const scheduledAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    prisma.meeting.findUnique.mockResolvedValue({
      id: 'm1',
      coopId: 'c1',
      status: 'DRAFT',
      scheduledAt,
      agendaItems: [],
      coop: { name: 'Co' },
    });
    prisma.shareholder.findMany.mockResolvedValue([]);
    prisma.meeting.update.mockResolvedValue({});
    await service.send('c1', 'm1', { confirmShortNotice: true });
    expect(prisma.meeting.update).toHaveBeenCalled();
  });

  it('is idempotent if meeting is already CONVOKED', async () => {
    prisma.meeting.findUnique.mockResolvedValue({
      id: 'm1',
      coopId: 'c1',
      status: 'CONVOKED',
      scheduledAt: new Date(),
      agendaItems: [],
      coop: { name: 'Co' },
    });
    const res = await service.send('c1', 'm1', {});
    expect(res).toEqual({ alreadySent: true });
  });
});
