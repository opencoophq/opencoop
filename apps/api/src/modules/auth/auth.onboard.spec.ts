jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

import * as Sentry from '@sentry/nestjs';
import { ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService.onboard', () => {
  const createdAt = new Date('2026-08-13T12:00:00.000Z');
  const dto = {
    email: 'Ada@Zukunftdorf.example',
    password: 'Secret123',
    coopName: 'Zukunftdorf Billberge',
    coopSlug: 'zukunftdorf-billberge',
    plan: 'essentials' as const,
    name: 'Ada Admin',
    preferredLanguage: 'de',
    termsAccepted: true,
  };

  function build() {
    const user = {
      id: 'user-1',
      email: 'ada@zukunftdorf.example',
      name: 'Ada Admin',
      role: 'COOP_ADMIN',
      preferredLanguage: 'de',
    };
    const coop = {
      id: 'coop-1',
      name: dto.coopName,
      slug: dto.coopSlug,
      plan: 'ESSENTIALS',
      legalForm: null,
      coopAddress: null,
      createdAt,
    };
    const tx = {
      user: { create: jest.fn().mockResolvedValue(user) },
      coop: { create: jest.fn().mockResolvedValue(coop) },
      coopRole: {
        create: jest.fn(async ({ data }: { data: { name: string } }) => ({
          id: `role-${data.name}`,
          name: data.name,
        })),
      },
      coopAdmin: { create: jest.fn().mockResolvedValue({ id: 'ca-1' }) },
      coopAdminRole: { create: jest.fn().mockResolvedValue({}) },
      channel: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      coop: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const auditService = { log: jest.fn().mockResolvedValue(undefined) };
    const emailService = { notifyCoopCreated: jest.fn() };
    const authEmail = { sendVerificationEmail: jest.fn().mockResolvedValue(undefined) };
    const tokenService = {
      issueJwtForUser: jest.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
    };
    const coopsService = { generateUniqueOgmPrefix: jest.fn().mockResolvedValue('004') };

    const service = new AuthService(
      prisma as never,
      {} as never,
      {} as never,
      emailService as never,
      authEmail as never,
      coopsService as never,
      auditService as never,
      tokenService as never,
    );

    return { service, prisma, auditService, emailService, authEmail, tx };
  }

  it('writes an audit row for the new admin and notifies Armlab without waiting on SMTP', async () => {
    const { service, auditService, emailService, authEmail } = build();

    const result = await service.onboard(dto, '203.0.113.10', 'Mozilla/5.0');

    expect(result.coop).toEqual({ id: 'coop-1', name: dto.coopName, slug: dto.coopSlug });
    expect(auditService.log).toHaveBeenCalledWith({
      coopId: 'coop-1',
      entity: 'Coop',
      entityId: 'coop-1',
      action: 'CREATE',
      changes: [
        { field: 'name', oldValue: null, newValue: dto.coopName },
        { field: 'slug', oldValue: null, newValue: dto.coopSlug },
        { field: 'plan', oldValue: null, newValue: 'ESSENTIALS' },
        { field: 'adminEmail', oldValue: null, newValue: 'ada@zukunftdorf.example' },
        { field: 'source', oldValue: null, newValue: 'self-signup' },
      ],
      actorId: 'user-1',
      ipAddress: '203.0.113.10',
      userAgent: 'Mozilla/5.0',
    });
    expect(emailService.notifyCoopCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        coopId: 'coop-1',
        name: dto.coopName,
        slug: dto.coopSlug,
        plan: 'ESSENTIALS',
        legalForm: null,
        country: null,
        adminEmail: 'ada@zukunftdorf.example',
        language: 'de',
        createdAt,
        source: 'self-signup',
      }),
    );
    expect(authEmail.sendVerificationEmail).toHaveBeenCalledWith(
      'ada@zukunftdorf.example',
      expect.any(String),
      'de',
    );
  });

  it('still logs the admin in when the internal notice throws', async () => {
    const { service, emailService, auditService } = build();
    emailService.notifyCoopCreated.mockImplementation(() => {
      throw new Error('notify exploded');
    });

    const result = await service.onboard(dto, '203.0.113.10', 'Mozilla/5.0');

    expect(result.accessToken).toBe('access');
    expect(auditService.log).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
  });

  it('does not audit or notify when the email is already registered', async () => {
    const { service, prisma, auditService, emailService } = build();
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(service.onboard(dto, '203.0.113.10')).rejects.toBeInstanceOf(ConflictException);
    expect(auditService.log).not.toHaveBeenCalled();
    expect(emailService.notifyCoopCreated).not.toHaveBeenCalled();
  });
});
