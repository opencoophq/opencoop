jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn() })),
}));

import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import * as Sentry from '@sentry/nestjs';
import * as nodemailer from 'nodemailer';
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
    coop: {
      findUnique: jest.fn(),
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
    const envKeys = [
      'COOP_SIGNUP_NOTIFY_EMAIL',
      'FRONTEND_URL',
      'SENTRY_ENVIRONMENT',
      'NODE_ENV',
    ] as const;
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
          subject: '[acc] Nieuwe coöperatie: Zukunftdorf Billberge',
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

  describe('sendPlatformEmail', () => {
    const envKeys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const;
    const previous: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};
    const loginCode = '482913';
    const magicToken = 'ab'.repeat(32);
    const resetToken = 'cd'.repeat(32);
    const smtpPass = 'super-secret-smtp-pass';
    const html = [
      `<p>Je inlogcode: ${loginCode}</p>`,
      `<a href="https://opencoop.be/zonne/magic-link?token=${magicToken}">Inloggen</a>`,
      `<a href="https://opencoop.be/reset-password?token=${resetToken}">Reset</a>`,
    ].join('');
    const text = `Je inlogcode: ${loginCode}\nhttps://opencoop.be/magic-link?token=${magicToken}`;

    let sendMail: jest.Mock;

    beforeEach(() => {
      for (const key of envKeys) previous[key] = process.env[key];
      process.env.SMTP_HOST = 'smtp-relay.brevo.com';
      process.env.SMTP_PORT = '587';
      process.env.SMTP_USER = 'relay@smtp-brevo.com';
      process.env.SMTP_PASS = smtpPass;
      process.env.SMTP_FROM = 'OpenCoop <noreply@opencoop.be>';

      sendMail = jest.fn().mockResolvedValue({
        accepted: ['member@example.com'],
        rejected: [],
        response: '250 2.0.0 Ok: queued as <20261109.abc@smtp-relay.mailin.fr>',
        messageId: '<client-generated@opencoop.be>',
      });
      (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
      mockPrisma.emailLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.coop.findUnique.mockResolvedValue(null);
      (Sentry.captureException as jest.Mock).mockClear();
    });

    afterEach(() => {
      for (const key of envKeys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });

    function loggedRow() {
      expect(mockPrisma.emailLog.create).toHaveBeenCalledTimes(1);
      return mockPrisma.emailLog.create.mock.calls[0][0].data;
    }

    function expectNoSecrets(value: unknown) {
      const serialized = JSON.stringify(value);
      expect(serialized).not.toContain(loginCode);
      expect(serialized).not.toContain(magicToken);
      expect(serialized).not.toContain(resetToken);
      expect(serialized).not.toContain(smtpPass);
      expect(serialized).not.toContain('Je inlogcode: 482913');
    }

    const mail = {
      to: 'member@example.com',
      subject: 'Je inlogcode voor OpenCoop',
      templateKey: 'magic-link',
      coopId: 'coop-1',
      html,
      text,
    };

    it('records an accepted send with the Brevo message id and no mail body', async () => {
      await service.sendPlatformEmail(mail);

      const row = loggedRow();
      expect(row).toEqual({
        coopId: 'coop-1',
        recipientEmail: 'member@example.com',
        subject: 'Je inlogcode voor OpenCoop',
        templateKey: 'magic-link',
        status: 'ACCEPTED',
        sentAt: expect.any(Date),
        errorMessage: null,
        providerMessageId: '20261109.abc@smtp-relay.mailin.fr',
        smtpResponse: '250 2.0.0 Ok: queued as <20261109.abc@smtp-relay.mailin.fr>',
        fromAddress: 'noreply@opencoop.be',
      });
      expect(row).not.toHaveProperty('html');
      expect(row).not.toHaveProperty('text');
      expectNoSecrets(row);
      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ html, text, to: 'member@example.com' }),
      );
    });

    it('falls back to the submitted Message-ID when the SMTP reply has no id', async () => {
      sendMail.mockResolvedValue({
        accepted: ['member@example.com'],
        rejected: [],
        response: '250 2.0.0 Ok',
        messageId: '<fallback-id@opencoop.be>',
      });

      await service.sendPlatformEmail({
        ...mail,
        templateKey: 'password-reset',
        coopId: undefined,
      });

      expect(loggedRow()).toEqual(
        expect.objectContaining({
          coopId: null,
          templateKey: 'password-reset',
          status: 'ACCEPTED',
          providerMessageId: 'fallback-id@opencoop.be',
          smtpResponse: '250 2.0.0 Ok',
        }),
      );
    });

    it('records an SMTP rejection and still throws the provider error', async () => {
      const failure = Object.assign(new Error('Message failed: 550 5.7.1 Recipient rejected'), {
        responseCode: 550,
        response: '550 5.7.1 Recipient rejected',
        code: 'EENVELOPE',
      });
      sendMail.mockRejectedValue(failure);

      await expect(service.sendPlatformEmail(mail)).rejects.toBe(failure);

      expect(loggedRow()).toEqual(
        expect.objectContaining({
          status: 'REJECTED',
          sentAt: null,
          errorMessage: 'Message failed: 550 5.7.1 Recipient rejected',
          smtpResponse: '550 5.7.1 Recipient rejected',
          providerMessageId: null,
          templateKey: 'magic-link',
        }),
      );
      expectNoSecrets(loggedRow());
    });

    it('records a transport failure as error', async () => {
      const failure = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:587'), {
        code: 'ECONNECTION',
      });
      sendMail.mockRejectedValue(failure);

      await expect(service.sendPlatformEmail(mail)).rejects.toBe(failure);

      expect(loggedRow()).toEqual(
        expect.objectContaining({
          status: 'ERROR',
          sentAt: null,
          errorMessage: 'connect ECONNREFUSED 127.0.0.1:587',
          smtpResponse: null,
          providerMessageId: null,
        }),
      );
    });

    it('does not store login codes, magic-link tokens, reset tokens, or the SMTP password', async () => {
      const echoed = `550 refused token=${magicToken} code ${loginCode} pass ${smtpPass} reset ${resetToken}`;
      const failure = Object.assign(new Error(echoed), {
        responseCode: 550,
        response: echoed,
        code: 'EENVELOPE',
      });
      sendMail.mockRejectedValue(failure);

      await expect(
        service.sendPlatformEmail({
          ...mail,
          subject: `Code ${loginCode}`,
          templateKey: magicToken,
        }),
      ).rejects.toBe(failure);

      const row = loggedRow();
      expectNoSecrets(row);
      expect(row.subject).toBe('Code [redacted]');
      expect(row.templateKey).toBe('platform');
      expect(row.smtpResponse).not.toContain(magicToken);
      expect(row.errorMessage).toContain('[redacted]');
      expect(row.status).toBe('REJECTED');
    });

    it('still returns after a successful send when writing the log fails', async () => {
      const dbError = new Error('db down');
      mockPrisma.emailLog.create.mockRejectedValue(dbError);
      const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.sendPlatformEmail(mail)).resolves.toBeUndefined();

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledWith(dbError);
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('db down'));
      expect(errorLog.mock.calls.flat().join(' ')).not.toContain(loginCode);
      expect(errorLog.mock.calls.flat().join(' ')).not.toContain(magicToken);
    });

    it('reports a logging failure and still throws the SMTP rejection', async () => {
      const failure = Object.assign(new Error('Message failed: 550 mailbox unavailable'), {
        responseCode: 550,
        response: '550 mailbox unavailable',
        code: 'EENVELOPE',
      });
      sendMail.mockRejectedValue(failure);
      const dbError = new Error('db down');
      mockPrisma.emailLog.create.mockRejectedValue(dbError);

      await expect(service.sendPlatformEmail(mail)).rejects.toBe(failure);
      expect(Sentry.captureException).toHaveBeenCalledWith(dbError);
    });

    const verifiedCoop = {
      name: 'Bronsgroen CV',
      coopEmail: 'info@bronsgroen.be',
      senderDomain: 'bronsgroen.be',
      senderFromAddress: 'noreply@bronsgroen.be',
      senderFromName: 'Bronsgroen',
      senderDomainStatus: 'verified',
      senderDomainProofAt: new Date('2026-11-10T10:00:00Z'),
    };

    it('keeps the platform address and the coop display name when the domain is not verified', async () => {
      mockPrisma.coop.findUnique.mockResolvedValue({
        ...verifiedCoop,
        senderDomainStatus: 'pending',
      });

      await service.sendPlatformEmail(mail);

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'Bronsgroen <noreply@opencoop.be>',
          replyTo: 'info@bronsgroen.be',
        }),
      );
      expect(loggedRow()).toEqual(
        expect.objectContaining({
          status: 'ACCEPTED',
          fromAddress: 'noreply@opencoop.be',
          templateKey: 'magic-link',
        }),
      );
    });

    it('sends from the coop domain when it is verified and records that address', async () => {
      mockPrisma.coop.findUnique.mockResolvedValue(verifiedCoop);

      await service.sendPlatformEmail(mail);

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'Bronsgroen <noreply@bronsgroen.be>',
          replyTo: 'info@bronsgroen.be',
        }),
      );
      const row = loggedRow();
      expect(row).toEqual(
        expect.objectContaining({
          status: 'ACCEPTED',
          fromAddress: 'noreply@bronsgroen.be',
          coopId: 'coop-1',
          templateKey: 'magic-link',
        }),
      );
      expectNoSecrets(row);
    });

    it('retries auth-critical mail from the platform sender when the coop domain is refused', async () => {
      mockPrisma.coop.findUnique.mockResolvedValue(verifiedCoop);
      const failure = Object.assign(new Error('Message failed: 550 5.7.1 Sender rejected'), {
        responseCode: 550,
        response: '550 5.7.1 Sender rejected',
        code: 'EENVELOPE',
      });
      sendMail.mockRejectedValueOnce(failure);

      await expect(service.sendPlatformEmail(mail)).resolves.toBeUndefined();

      expect(sendMail).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ from: 'Bronsgroen <noreply@bronsgroen.be>' }),
      );
      expect(sendMail).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ from: 'Bronsgroen <noreply@opencoop.be>' }),
      );
      expect(mockPrisma.emailLog.create).toHaveBeenCalledTimes(2);
      const failed = mockPrisma.emailLog.create.mock.calls[0][0].data;
      const sent = mockPrisma.emailLog.create.mock.calls[1][0].data;
      expect(failed).toEqual(
        expect.objectContaining({
          status: 'REJECTED',
          fromAddress: 'noreply@bronsgroen.be',
          sentAt: null,
        }),
      );
      expect(sent).toEqual(
        expect.objectContaining({
          status: 'ACCEPTED',
          fromAddress: 'noreply@opencoop.be',
        }),
      );
      expectNoSecrets(failed);
      expectNoSecrets(sent);
    });

    it('retries the platform sender when the relay rejects the coop address without throwing', async () => {
      mockPrisma.coop.findUnique.mockResolvedValue(verifiedCoop);
      sendMail.mockResolvedValueOnce({
        accepted: [],
        rejected: ['member@example.com'],
        response: '550 5.7.1 Sender not allowed',
        messageId: '<m1@opencoop.be>',
      });

      await expect(service.sendPlatformEmail(mail)).resolves.toBeUndefined();

      expect(sendMail).toHaveBeenCalledTimes(2);
      expect(sendMail).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ from: 'Bronsgroen <noreply@opencoop.be>' }),
      );
      const rows = mockPrisma.emailLog.create.mock.calls.map((call) => call[0].data);
      expect(rows.map((row) => [row.status, row.fromAddress])).toEqual([
        ['REJECTED', 'noreply@bronsgroen.be'],
        ['ACCEPTED', 'noreply@opencoop.be'],
      ]);
    });

    it('sends from the platform address when the row says verified but has no DNS proof', async () => {
      mockPrisma.coop.findUnique.mockResolvedValue({ ...verifiedCoop, senderDomainProofAt: null });

      await service.sendPlatformEmail(mail);

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'Bronsgroen <noreply@opencoop.be>' }),
      );
      expect(loggedRow()).toEqual(expect.objectContaining({ fromAddress: 'noreply@opencoop.be' }));
    });

    it('does not need BREVO_API_KEY or the Brevo API to send login mail', async () => {
      const previousKey = process.env.BREVO_API_KEY;
      delete process.env.BREVO_API_KEY;
      const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Brevo is down'));
      try {
        mockPrisma.coop.findUnique.mockResolvedValue(verifiedCoop);
        await expect(service.sendPlatformEmail(mail)).resolves.toBeUndefined();
        expect(sendMail).toHaveBeenCalledTimes(1);
        expect(fetchSpy).not.toHaveBeenCalled();

        // An unproven row still delivers, from the platform address.
        sendMail.mockClear();
        mockPrisma.coop.findUnique.mockResolvedValue({
          ...verifiedCoop,
          senderDomainProofAt: null,
        });
        await expect(service.sendPlatformEmail(mail)).resolves.toBeUndefined();
        expect(sendMail).toHaveBeenCalledWith(
          expect.objectContaining({ from: 'Bronsgroen <noreply@opencoop.be>' }),
        );
      } finally {
        fetchSpy.mockRestore();
        if (previousKey !== undefined) process.env.BREVO_API_KEY = previousKey;
      }
    });

    it('quotes a display name that contains a comma so it is not read as two addresses', async () => {
      mockPrisma.coop.findUnique.mockResolvedValue({
        ...verifiedCoop,
        senderFromName: 'Zon, Wind & Co',
      });

      await service.sendPlatformEmail(mail);

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: '"Zon, Wind & Co" <noreply@bronsgroen.be>' }),
      );
    });

    it('does not retry a non-auth mail when the coop domain is refused', async () => {
      mockPrisma.coop.findUnique.mockResolvedValue(verifiedCoop);
      const failure = Object.assign(new Error('Message failed: 550 5.7.1 Sender rejected'), {
        responseCode: 550,
        response: '550 5.7.1 Sender rejected',
        code: 'EENVELOPE',
      });
      sendMail.mockRejectedValue(failure);

      await expect(
        service.sendPlatformEmail({ ...mail, templateKey: 'admin-invitation' }),
      ).rejects.toBe(failure);

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(loggedRow()).toEqual(
        expect.objectContaining({
          status: 'REJECTED',
          fromAddress: 'noreply@bronsgroen.be',
          templateKey: 'admin-invitation',
        }),
      );
    });

    it('still sends from the platform address when the sender lookup fails', async () => {
      mockPrisma.coop.findUnique.mockRejectedValue(new Error('db down'));
      const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.sendPlatformEmail(mail)).resolves.toBeUndefined();

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'OpenCoop <noreply@opencoop.be>' }),
      );
      expect(loggedRow().fromAddress).toBe('noreply@opencoop.be');
      expect(errorLog.mock.calls.flat().join(' ')).not.toContain(loginCode);
    });

    it('does not write a log when platform SMTP is not configured', async () => {
      delete process.env.SMTP_HOST;

      await expect(service.sendPlatformEmail(mail)).resolves.toBeUndefined();

      expect(sendMail).not.toHaveBeenCalled();
      expect(mockPrisma.emailLog.create).not.toHaveBeenCalled();
    });
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
