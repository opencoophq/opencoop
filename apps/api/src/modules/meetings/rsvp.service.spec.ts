import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RsvpService } from './rsvp.service';
import { ProxiesService } from './proxies.service';
import { IcsService } from './ics.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RSVPStatus } from '@opencoop/database';

type Mock = jest.Mock;

describe('RsvpService.resolveDelegate', () => {
  let service: RsvpService;
  let prisma: {
    meetingAttendance: { findUnique: Mock; update: Mock };
    shareholder: { findMany: Mock };
    proxy: { count: Mock; findFirst: Mock; update: Mock; updateMany: Mock };
  };
  let proxies: { create: Mock };

  const future = new Date(Date.now() + 60_000);
  const baseAttendance = {
    id: 'att-1',
    meetingId: 'm-1',
    shareholderId: 'gA',
    rsvpToken: 'tok',
    rsvpTokenExpires: future,
    proxyResolveAttempts: 0,
    meeting: {
      id: 'm-1',
      title: 'AGM',
      coopId: 'c-1',
      scheduledAt: future,
      durationMinutes: 90,
      location: null,
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
      proxy: {
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    proxies = { create: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RsvpService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProxiesService, useValue: proxies },
        { provide: IcsService, useValue: { generate: jest.fn(() => 'ics') } },
        { provide: EmailService, useValue: { send: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(RsvpService);
  });

  it('returns unique on exact name match within cap', async () => {
    prisma.meetingAttendance.findUnique.mockResolvedValue(baseAttendance);
    prisma.meetingAttendance.update.mockResolvedValue({
      ...baseAttendance,
      proxyResolveAttempts: 1,
    });
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
    prisma.meetingAttendance.findUnique.mockResolvedValue({
      ...baseAttendance,
      proxyResolveAttempts: 20,
    });
    prisma.meetingAttendance.update.mockResolvedValue({
      ...baseAttendance,
      proxyResolveAttempts: 21,
    });

    await expect(service.resolveDelegate('tok', 'Jan', 'Peeters')).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({ code: 'rate_limited' }),
    });
    expect(prisma.shareholder.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 not_found when no candidate matches', async () => {
    prisma.meetingAttendance.findUnique.mockResolvedValue(baseAttendance);
    prisma.meetingAttendance.update.mockResolvedValue({
      ...baseAttendance,
      proxyResolveAttempts: 1,
    });
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
    prisma.meetingAttendance.update.mockResolvedValue({
      ...baseAttendance,
      proxyResolveAttempts: 1,
    });
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
    prisma.meetingAttendance.update.mockResolvedValue({
      ...baseAttendance,
      proxyResolveAttempts: 1,
    });
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
    await expect(service.resolveDelegate('tok', 'Jan', 'Peeters')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.meetingAttendance.update).not.toHaveBeenCalled();
  });

  it('updates an admin RSVP by meeting and shareholder without requiring token freshness', async () => {
    const expiredAttendance = {
      ...baseAttendance,
      rsvpTokenExpires: new Date(Date.now() - 60_000),
    };
    prisma.meetingAttendance.findUnique.mockResolvedValue(expiredAttendance);
    prisma.meetingAttendance.update.mockResolvedValue({
      ...expiredAttendance,
      rsvpStatus: RSVPStatus.ATTENDING,
      rsvpAt: future,
    });

    await service.updateRsvpForShareholder('c-1', 'm-1', 'gA', RSVPStatus.ATTENDING);

    expect(prisma.meetingAttendance.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { meetingId_shareholderId: { meetingId: 'm-1', shareholderId: 'gA' } },
      }),
    );
    expect(prisma.meetingAttendance.update).toHaveBeenCalledWith({
      where: { id: 'att-1' },
      data: { rsvpStatus: RSVPStatus.ATTENDING, rsvpAt: expect.any(Date) },
    });
  });

  it('uses proxy validation when an admin records a proxy RSVP', async () => {
    prisma.meetingAttendance.findUnique.mockResolvedValue(baseAttendance);
    prisma.proxy.findFirst.mockResolvedValue(null);
    prisma.meetingAttendance.update.mockResolvedValue({
      ...baseAttendance,
      rsvpStatus: RSVPStatus.PROXY,
      rsvpAt: future,
    });

    await service.updateRsvpForShareholder('c-1', 'm-1', 'gA', RSVPStatus.PROXY, 'sB');

    expect(proxies.create).toHaveBeenCalledWith('c-1', 'm-1', 'gA', 'sB');
  });

  it('rejects admin RSVP updates for meetings outside the coop', async () => {
    prisma.meetingAttendance.findUnique.mockResolvedValue({
      ...baseAttendance,
      meeting: { ...baseAttendance.meeting, coopId: 'other' },
    });

    await expect(
      service.updateRsvpForShareholder('c-1', 'm-1', 'gA', RSVPStatus.ATTENDING),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
