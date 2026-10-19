jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import * as Sentry from '@sentry/nestjs';
import { EmailService } from './email.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('EmailService', () => {
  let service: EmailService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
    emailLog: {
      create: jest.fn(),
    },
  };

  const mockQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken('email'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    jest.clearAllMocks();
  });

  describe('resolveRecipientLanguage', () => {
    it('returns the user preferredLanguage when set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'fr' });
      const result = await (service as any).resolveRecipientLanguage('user@example.com');
      expect(result).toBe('fr');
    });

    it('returns "nl" when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await (service as any).resolveRecipientLanguage('nobody@example.com');
      expect(result).toBe('nl');
    });

    it('returns "nl" when preferredLanguage is empty or null', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: null });
      const result = await (service as any).resolveRecipientLanguage('user@example.com');
      expect(result).toBe('nl');

      mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: '' });
      const result2 = await (service as any).resolveRecipientLanguage('user@example.com');
      expect(result2).toBe('nl');
    });

    it('lowercases the email when looking up', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'en' });
      await (service as any).resolveRecipientLanguage('User@Example.COM');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
        select: { preferredLanguage: true },
      });
    });
  });

  describe('notifyCoopCreated', () => {
    const notice = {
      coopId: 'coop-1',
      name: 'Zukunftdorf Billberge',
      slug: 'zukunftdorf-billberge',
      plan: 'FREE',
      adminEmail: 'ada@zukunftdorf.example',
      language: 'de',
      createdAt: new Date('2026-08-13T12:00:00.000Z'),
      source: 'self-signup' as const,
    };
    const envKeys = ['COOP_SIGNUP_NOTIFY_EMAIL', 'FRONTEND_URL', 'SENTRY_ENVIRONMENT', 'NODE_ENV'] as const;
    const previous: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

    beforeEach(() => {
      for (const key of envKeys) previous[key] = process.env[key];
      delete process.env.COOP_SIGNUP_NOTIFY_EMAIL;
      delete process.env.SENTRY_ENVIRONMENT;
      process.env.FRONTEND_URL = 'https://acc.opencoop.be';
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      for (const key of envKeys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      jest.restoreAllMocks();
    });

    it('sends the Dutch platform mail and does not wait for the caller to catch SMTP errors', async () => {
      const send = jest.spyOn(service, 'sendPlatformEmail').mockResolvedValue(undefined);

      service.notifyCoopCreated(notice);
      await flush();

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'info@opencoop.be',
          subject: '[acceptance] Nieuwe coöperatie: Zukunftdorf Billberge',
          text: expect.stringContaining('Beheerder: ada@zukunftdorf.example'),
        }),
      );
    });

    it('skips sending when COOP_SIGNUP_NOTIFY_EMAIL=off', async () => {
      process.env.COOP_SIGNUP_NOTIFY_EMAIL = 'off';
      const send = jest.spyOn(service, 'sendPlatformEmail').mockResolvedValue(undefined);

      service.notifyCoopCreated(notice);
      await flush();

      expect(send).not.toHaveBeenCalled();
    });

    it('logs and reports to GlitchTip when sending fails, without rejecting', async () => {
      const failure = new Error('smtp down');
      jest.spyOn(service, 'sendPlatformEmail').mockRejectedValue(failure);
      const capture = Sentry.captureException as jest.Mock;
      capture.mockClear();
      const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      expect(() => service.notifyCoopCreated(notice)).not.toThrow();
      await flush();

      expect(capture).toHaveBeenCalledWith(failure);
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('smtp down'));
    });
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
