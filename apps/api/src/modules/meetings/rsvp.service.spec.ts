import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RsvpService } from './rsvp.service';
import { ProxiesService } from './proxies.service';
import { IcsService } from './ics.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';

type Mock = jest.Mock;

describe('RsvpService.resolveDelegate', () => {
  let service: RsvpService;
  let prisma: {
    meetingAttendance: { findUnique: Mock; update: Mock };
    shareholder: { findMany: Mock };
    proxy: { count: Mock };
  };

  const future = new Date(Date.now() + 60_000);
  const baseAttendance = {
    id: 'att-1',
    meetingId: 'm-1',
    shareholderId: 'gA',
    rsvpToken: 'tok',
    rsvpTokenExpires: future,
    proxyResolveAttempts: 0,
    meeting: {
      coopId: 'c-1',
      maxProxiesPerPerson: 1,
      coop: { id: 'c-1', name: 'X', slug: 'x', logoUrl: null, coopEmail: null },
      agendaItems: [],
    },
    shareholder: { id: 'gA', firstName: 'Maria', lastName: 'de Bruyn', user: null },
  };

  beforeEach(async () => {
    prisma = {
      meetingAttendance: { findUnique: jest.fn(), update: jest.fn() },
      shareholder: { findMany: jest.fn() },
      proxy: { count: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RsvpService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProxiesService, useValue: {} },
        { provide: IcsService, useValue: {} },
        { provide: EmailService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(RsvpService);
  });

  it('returns unique on exact name match within cap', async () => {
    prisma.meetingAttendance.findUnique.mockResolvedValue(baseAttendance);
    prisma.meetingAttendance.update.mockResolvedValue({ ...baseAttendance, proxyResolveAttempts: 1 });
    prisma.shareholder.findMany.mockResolvedValue([
      { id: 'sB', firstName: 'Jan', lastName: 'Peeters' },
    ]);
    prisma.proxy.count.mockResolvedValue(0);

    const res = await service.resolveDelegate('tok', 'Jan', 'Peeters');
    expect(res).toEqual({ delegateShareholderId: 'sB', displayName: 'Jan Peeters' });
    expect(prisma.meetingAttendance.update).toHaveBeenCalledWith({
      where: { id: 'att-1' },
      data: { proxyResolveAttempts: { increment: 1 } },
    });
  });

  it('returns 429 with rate_limited when attempts exceed 20', async () => {
    prisma.meetingAttendance.findUnique.mockResolvedValue({ ...baseAttendance, proxyResolveAttempts: 20 });
    prisma.meetingAttendance.update.mockResolvedValue({ ...baseAttendance, proxyResolveAttempts: 21 });

    await expect(service.resolveDelegate('tok', 'Jan', 'Peeters')).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({ code: 'rate_limited' }),
    });
    expect(prisma.shareholder.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 not_found when no candidate matches', async () => {
    prisma.meetingAttendance.findUnique.mockResolvedValue(baseAttendance);
    prisma.meetingAttendance.update.mockResolvedValue({ ...baseAttendance, proxyResolveAttempts: 1 });
    prisma.shareholder.findMany.mockResolvedValue([
      { id: 'sB', firstName: 'Hans', lastName: 'Schmidt' },
    ]);

    await expect(service.resolveDelegate('tok', 'Jan', 'Peeters')).rejects.toMatchObject({
      status: 404,
      response: expect.objectContaining({ code: 'not_found' }),
    });
  });

  it('returns 409 ambiguous when multiple candidates tie', async () => {
    prisma.meetingAttendance.findUnique.mockResolvedValue(baseAttendance);
    prisma.meetingAttendance.update.mockResolvedValue({ ...baseAttendance, proxyResolveAttempts: 1 });
    prisma.shareholder.findMany.mockResolvedValue([
      { id: 'sB', firstName: 'Jan', lastName: 'Peeters' },
      { id: 'sC', firstName: 'jan', lastName: 'peeters' },
    ]);

    await expect(service.resolveDelegate('tok', 'Jan', 'Peeters')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'ambiguous' }),
    });
  });

  it('returns 400 cap_reached when matched delegate is at the cap', async () => {
    prisma.meetingAttendance.findUnique.mockResolvedValue(baseAttendance);
    prisma.meetingAttendance.update.mockResolvedValue({ ...baseAttendance, proxyResolveAttempts: 1 });
    prisma.shareholder.findMany.mockResolvedValue([
      { id: 'sB', firstName: 'Jan', lastName: 'Peeters' },
    ]);
    prisma.proxy.count.mockResolvedValue(1); // already at maxProxiesPerPerson=1

    await expect(service.resolveDelegate('tok', 'Jan', 'Peeters')).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'cap_reached' }),
    });
  });

  it('throws on expired token', async () => {
    prisma.meetingAttendance.findUnique.mockResolvedValue({
      ...baseAttendance,
      rsvpTokenExpires: new Date(Date.now() - 60_000),
    });
    await expect(service.resolveDelegate('tok', 'Jan', 'Peeters')).rejects.toThrow(BadRequestException);
    expect(prisma.meetingAttendance.update).not.toHaveBeenCalled();
  });
});
