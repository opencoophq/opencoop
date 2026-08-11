import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { KioskService } from './kiosk.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('KioskService', () => {
  let service: KioskService;

  const mockPrisma = {
    meetingKioskSession: {
      findUnique: jest.fn(),
    },
  };

  const makeSession = (overrides: Record<string, unknown> = {}) => ({
    id: 'session-1',
    active: true,
    meetingId: 'meeting-1',
    meeting: {
      id: 'meeting-1',
      coopId: 'coop-1',
      scheduledAt: new Date('2026-06-20T10:00:00.000Z'),
      coop: { name: 'Open Coop', logoUrl: null },
    },
    ...overrides,
  });

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [KioskService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<KioskService>(KioskService);
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-06-20T15:59:59.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('validate', () => {
    it('throws when the kiosk token does not match a session', async () => {
      mockPrisma.meetingKioskSession.findUnique.mockResolvedValue(null);

      await expect(service.validate('bad-token')).rejects.toThrow(NotFoundException);
    });

    it('throws when the kiosk session was manually ended', async () => {
      mockPrisma.meetingKioskSession.findUnique.mockResolvedValue(makeSession({ active: false }));

      try {
        await service.validate('ended-token');
        fail('Expected validate to reject an ended kiosk session');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as Error).message).toBe('Kiosk session ended');
      }
    });

    it('returns an active kiosk session before the six-hour expiry', async () => {
      const session = makeSession();
      mockPrisma.meetingKioskSession.findUnique.mockResolvedValue(session);

      await expect(service.validate('valid-token')).resolves.toBe(session);
    });

    it('throws when the meeting kiosk session is more than six hours past the scheduled time', async () => {
      jest.setSystemTime(new Date('2026-06-20T16:00:01.000Z'));
      mockPrisma.meetingKioskSession.findUnique.mockResolvedValue(makeSession());

      try {
        await service.validate('expired-token');
        fail('Expected validate to reject an expired kiosk session');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as Error).message).toBe('Kiosk session expired');
      }
    });
  });
});
