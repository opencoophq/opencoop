import { BadRequestException, ConflictException } from '@nestjs/common';
import { VolunteersService } from './volunteers.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { MessagesService } from '../messages/messages.service';
import { VOLUNTEER_VIEW_SELECT } from './volunteer-record';

describe('VolunteersService', () => {
  const prisma = {
    coop: { findUnique: jest.fn() },
    volunteer: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      groupBy: jest.fn(),
    },
    shareholder: { findFirst: jest.fn(), findMany: jest.fn() },
  };
  const audit = { log: jest.fn() };
  const email = { send: jest.fn() };
  const messages = { createConversation: jest.fn() };
  const service = new VolunteersService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    email as unknown as EmailService,
    messages as unknown as MessagesService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('public info returns branding and interests, not share classes', async () => {
    prisma.coop.findUnique.mockResolvedValue({
      name: 'Bronsgroen',
      volunteersEnabled: true,
      volunteerInterests: [],
      channels: [{ logoUrl: '/logo.png', primaryColor: '#0E7C66' }],
    });

    const info = await service.publicInfo('bronsgroen');

    expect(info).toEqual({
      coopName: 'Bronsgroen',
      logoUrl: '/logo.png',
      primaryColor: '#0E7C66',
      interests: ['flyers', 'stands', 'workshops', 'technical', 'admin'],
      consentTextVersion: 'volunteer-consent-v1',
    });
    const select = prisma.coop.findUnique.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('shareClasses');
    expect(select).not.toHaveProperty('shareholders');
  });

  it('rejects a public signup without consent and ignores a honeypot fill', async () => {
    prisma.coop.findUnique.mockResolvedValue({
      id: 'c1',
      name: 'Bronsgroen',
      volunteersEnabled: true,
      volunteerInterests: [],
      emailEnabled: true,
    });

    await expect(
      service.publicSignup('bronsgroen', {
        name: 'An',
        email: 'an@example.be',
        postalCode: '3600',
        municipality: 'Genk',
        interests: ['flyers'],
        consent: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.volunteer.create).not.toHaveBeenCalled();

    await expect(
      service.publicSignup('bronsgroen', {
        name: 'Bot',
        email: 'bot@example.be',
        postalCode: '3600',
        municipality: 'Genk',
        interests: ['flyers'],
        consent: true,
        website: 'http://spam.test',
      }),
    ).resolves.toEqual({ ok: true });
    expect(prisma.volunteer.create).not.toHaveBeenCalled();
  });

  it('does not link an anonymous signup to a shareholder with the same email', async () => {
    prisma.coop.findUnique.mockResolvedValue({
      id: 'c1',
      name: 'Bronsgroen',
      volunteersEnabled: true,
      volunteerInterests: [],
      emailEnabled: true,
    });
    prisma.volunteer.findUnique.mockResolvedValue(null);
    prisma.volunteer.create.mockResolvedValue({ id: 'v1' });
    email.send.mockResolvedValue(undefined);

    await service.publicSignup('bronsgroen', {
      name: 'An',
      email: 'an@example.be',
      postalCode: '3600',
      municipality: 'Genk',
      interests: ['flyers'],
      consent: true,
    });

    expect(prisma.shareholder.findMany).not.toHaveBeenCalled();
    expect(prisma.volunteer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shareholderId: null, userId: null, email: 'an@example.be' }),
      }),
    );
  });

  it('links a signup when the email matches the logged-in user', async () => {
    prisma.coop.findUnique.mockResolvedValue({
      id: 'c1',
      name: 'Bronsgroen',
      volunteersEnabled: true,
      volunteerInterests: [],
      emailEnabled: true,
    });
    prisma.volunteer.findUnique.mockResolvedValue(null);
    prisma.shareholder.findMany.mockResolvedValue([
      { id: 'sh-1', userId: 'u1', email: 'an@example.be' },
    ]);
    prisma.volunteer.create.mockResolvedValue({ id: 'v1' });
    email.send.mockResolvedValue(undefined);

    await service.publicSignup(
      'bronsgroen',
      {
        name: 'An',
        email: 'An@Example.be',
        postalCode: '3600',
        municipality: 'Genk',
        interests: ['flyers'],
        consent: true,
      },
      { id: 'u1', email: 'an@example.be' },
    );

    expect(prisma.volunteer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shareholderId: 'sh-1', userId: 'u1' }),
      }),
    );
  });

  it('withdraws a volunteer and writes an audit entry', async () => {
    prisma.volunteer.findFirst.mockResolvedValue({
      id: 'v1',
      name: 'An',
      email: 'an@example.be',
      phone: null,
      postalCode: '3600',
      municipality: 'Genk',
      interests: ['flyers'],
      status: 'ACTIVE',
      consentAt: new Date('2026-10-19T08:00:00.000Z'),
      consentTextVersion: 'volunteer-consent-v1',
      createdAt: new Date('2026-10-19T08:00:00.000Z'),
      shareholderId: null,
    });
    prisma.volunteer.update.mockResolvedValue({
      id: 'v1',
      name: 'An',
      email: 'an@example.be',
      phone: null,
      postalCode: '3600',
      municipality: 'Genk',
      interests: ['flyers'],
      status: 'WITHDRAWN',
      consentAt: new Date('2026-10-19T08:00:00.000Z'),
      consentTextVersion: 'volunteer-consent-v1',
      createdAt: new Date('2026-10-19T08:00:00.000Z'),
      shareholderId: null,
    });

    const view = await service.adminWithdraw('c1', 'v1', { userId: 'admin-1' });

    expect(view.status).toBe('WITHDRAWN');
    expect(view).not.toHaveProperty('shareholderId');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityId: 'v1',
        changes: [{ field: 'status', oldValue: 'ACTIVE', newValue: 'WITHDRAWN' }],
      }),
    );
  });

  it('lists with the volunteer select and drops a shareholder payload if one is present', async () => {
    prisma.coop.findUnique.mockResolvedValue({
      id: 'c1',
      volunteerInterests: ['flyers'],
      volunteersEnabled: true,
    });
    prisma.volunteer.findMany
      .mockResolvedValueOnce([
        {
          id: 'v1',
          name: 'An',
          email: 'an@example.be',
          phone: null,
          postalCode: '3600',
          municipality: 'Genk',
          interests: ['flyers'],
          status: 'ACTIVE',
          consentAt: new Date('2026-10-19T08:00:00.000Z'),
          consentTextVersion: 'volunteer-consent-v1',
          createdAt: new Date('2026-10-19T08:00:00.000Z'),
          shareholderId: 'sh-1',
          shareholder: { nationalId: 'secret', registrations: [{ quantity: 4 }] },
        },
      ])
      .mockResolvedValueOnce([{ municipality: 'Genk' }]);
    prisma.volunteer.count.mockResolvedValue(1);

    const page = await service.adminList('c1', { municipality: 'Genk' });

    expect(prisma.volunteer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: VOLUNTEER_VIEW_SELECT }),
    );
    expect(page.items[0].memberLinked).toBe(true);
    expect(page.items[0]).not.toHaveProperty('shareholder');
    expect(page.items[0]).not.toHaveProperty('nationalId');
    expect(JSON.stringify(page)).not.toContain('secret');
    expect(JSON.stringify(page)).not.toContain('quantity');
  });

  it('writes an audit log for every csv export and the csv has no share data', async () => {
    prisma.coop.findUnique.mockResolvedValue({
      id: 'c1',
      volunteerInterests: [],
      volunteersEnabled: true,
    });
    prisma.volunteer.findMany.mockResolvedValue([
      {
        id: 'v1',
        name: 'An',
        email: 'an@example.be',
        phone: null,
        postalCode: '3600',
        municipality: 'Genk',
        interests: ['flyers'],
        status: 'ACTIVE',
        consentAt: new Date('2026-10-19T08:00:00.000Z'),
        consentTextVersion: 'volunteer-consent-v1',
        createdAt: new Date('2026-10-19T08:00:00.000Z'),
        shareholderId: null,
      },
    ]);

    const csv = await service.adminExport(
      'c1',
      { postalCode: '3600', interest: 'flyers' },
      { userId: 'admin-1', ip: '127.0.0.1', userAgent: 'jest' },
    );

    expect(csv).toContain('an@example.be');
    expect(csv).not.toContain('nationalId');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        coopId: 'c1',
        entity: 'Volunteer',
        action: 'EXPORT',
        actorId: 'admin-1',
        changes: expect.arrayContaining([
          expect.objectContaining({ field: 'rowCount', newValue: 1 }),
          expect.objectContaining({
            field: 'filters',
            newValue: expect.objectContaining({
              postalCode: '3600',
              interest: 'flyers',
              status: 'ACTIVE',
            }),
          }),
        ]),
      }),
    );
  });

  it('purges unconfirmed signups older than 30 days and leaves active rows', async () => {
    const now = new Date('2026-10-19T00:00:00.000Z');
    prisma.volunteer.groupBy.mockResolvedValue([{ coopId: 'c1', _count: { _all: 2 } }]);
    prisma.volunteer.deleteMany.mockResolvedValue({ count: 2 });

    await expect(service.purgeUnconfirmed(now)).resolves.toEqual({ purged: 2 });

    const cutoff = new Date('2026-09-19T00:00:00.000Z');
    expect(prisma.volunteer.deleteMany).toHaveBeenCalledWith({
      where: { status: 'PENDING_CONFIRMATION', createdAt: { lt: cutoff } },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        changes: [expect.objectContaining({ field: 'purgedUnconfirmed', newValue: 2 })],
      }),
    );
  });

  it('does not take over a volunteer linked to another member', async () => {
    prisma.shareholder.findFirst.mockResolvedValue({
      id: 'sh-1',
      coopId: 'c1',
      userId: 'u1',
      type: 'INDIVIDUAL',
      email: 'an@example.be',
      phone: null,
      firstName: 'An',
      lastName: 'Peeters',
      companyName: null,
      address: { postalCode: '3600', city: 'Genk' },
      user: { preferredLanguage: 'nl' },
      coop: {
        id: 'c1',
        name: 'Bronsgroen',
        volunteersEnabled: true,
        volunteerInterests: [],
        emailEnabled: true,
      },
    });
    prisma.volunteer.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'v-other',
      shareholderId: 'sh-2',
      email: 'an@example.be',
      withdrawToken: 'tok',
      consentAt: new Date(),
      status: 'ACTIVE',
    });

    await expect(
      service.memberOptIn('sh-1', 'u1', {
        interests: ['flyers'],
        consent: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.volunteer.update).not.toHaveBeenCalled();
    expect(prisma.volunteer.create).not.toHaveBeenCalled();
  });

  it('messages only through the volunteers audience', async () => {
    prisma.coop.findUnique.mockResolvedValue({
      id: 'c1',
      volunteerInterests: [],
      volunteersEnabled: true,
    });
    messages.createConversation.mockResolvedValue({ id: 'conv-1' });

    await service.adminMessage(
      'c1',
      {
        subject: 'Flyers',
        body: 'Zaterdag?',
        municipality: 'Genk',
        postalCode: '3600',
        interest: 'flyers',
      },
      { userId: 'admin-1' },
    );

    expect(messages.createConversation).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        type: 'BROADCAST',
        audience: {
          type: 'VOLUNTEERS',
          volunteerFilter: { municipality: 'Genk', postalCode: '3600', interest: 'flyers' },
        },
      }),
      'admin-1',
      undefined,
      undefined,
    );
  });
});
