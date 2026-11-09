jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MagicLinkService } from './magic-link.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuthEmailService } from './auth-email.service';
import { AuditService } from '../audit/audit.service';
import { TokenService, TokenService as RealTokenService } from './token.service';
import { buildCopy } from '../email/email-copy';
import * as codeModule from './magic-link-code';
import {
  MAGIC_LINK_CODE_EXPIRED,
  MAGIC_LINK_CODE_INVALID,
  MAGIC_LINK_CODE_LOCKED,
  MAGIC_LINK_EXPIRED,
  MAGIC_LINK_SENT_MESSAGE,
  MAGIC_LINK_TTL_MS,
  MAGIC_LINK_USED,
} from './magic-link.constants';

const SUCCESS = { message: MAGIC_LINK_SENT_MESSAGE };

const janUser = {
  id: 'jan-user-id',
  email: 'jan@x.com',
  name: 'Jan Peeters',
  role: 'SHAREHOLDER',
  preferredLanguage: 'nl',
  emailVerified: new Date(),
  mfaEnabled: false,
  coopAdminOf: [],
};

const otherUser = {
  ...janUser,
  id: 'other-id',
  email: 'other@x.com',
  preferredLanguage: 'en',
};

type Row = {
  id: string;
  token: string;
  userId: string;
  email: string;
  codeHash: string | null;
  codeSalt: string | null;
  failedAttempts: number;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
};

function matches(row: Row, where: any): boolean {
  if (!where) return true;
  const { OR, ...rest } = where;
  for (const [key, value] of Object.entries(rest)) {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const bound = value as { gte?: Date; gt?: Date; lt?: number };
      const current = (row as any)[key];
      if (bound.gte !== undefined && !(current >= bound.gte)) return false;
      if (bound.gt !== undefined && !(current > bound.gt)) return false;
      if (bound.lt !== undefined && !(current < bound.lt)) return false;
    } else if ((row as any)[key] !== value) {
      return false;
    }
  }
  if (OR && !OR.some((clause: any) => matches(row, clause))) return false;
  return true;
}

function applyData(row: Row, data: Record<string, any>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      (row as any)[key] = ((row as any)[key] ?? 0) + value.increment;
    } else {
      (row as any)[key] = value;
    }
  }
}

describe('MagicLinkService one-time code', () => {
  let service: MagicLinkService;
  let emailService: { sendPlatformEmail: jest.Mock };
  let tokenService: { issueJwtForUser: jest.Mock };
  let rows: Row[];
  const usersByEmail: Record<string, any> = {
    'jan@x.com': janUser,
    'other@x.com': otherUser,
  };
  const usersById: Record<string, any> = {
    [janUser.id]: janUser,
    [otherUser.id]: otherUser,
  };

  // Mirrors Prisma: permissionOverrides only comes back when the query selects it.
  function withUser(row: Row, include?: any) {
    const user = usersById[row.userId];
    const select = include?.user?.include?.coopAdminOf?.select;
    const coopAdminOf = (user.coopAdminOf ?? []).map((ca: any) => {
      const { permissionOverrides, ...rest } = ca;
      return select?.permissionOverrides ? ca : rest;
    });
    return { ...row, user: { ...user, coopAdminOf } };
  }

  beforeEach(async () => {
    rows = [];
    jest.spyOn(codeModule, 'generateLoginCode').mockReturnValue('482913');

    const prisma = {
      user: {
        findUnique: jest.fn(async ({ where }: any) => usersByEmail[where.email] ?? null),
        create: jest.fn(),
      },
      shareholder: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      channel: { findFirst: jest.fn().mockResolvedValue(null) },
      magicLinkToken: {
        count: jest.fn(async ({ where }: any) => rows.filter((row) => matches(row, where)).length),
        create: jest.fn(async ({ data }: any) => {
          const row: Row = {
            id: `tok-${rows.length + 1}`,
            failedAttempts: 0,
            usedAt: null,
            createdAt: new Date(),
            codeHash: null,
            codeSalt: null,
            ...data,
          };
          rows.push(row);
          return row;
        }),
        findUnique: jest.fn(async ({ where, include }: any) => {
          const row = rows.find((item) => matches(item, where));
          return row ? withUser(row, include) : null;
        }),
        findFirst: jest.fn(async ({ where, include }: any) => {
          const found = rows
            .filter((row) => matches(row, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return found[0] ? withUser(found[0], include) : null;
        }),
        findMany: jest.fn(async ({ where, include }: any) => {
          return rows
            .filter((row) => matches(row, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map((row) => withUser(row, include));
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const row of rows) {
            if (!matches(row, where)) continue;
            applyData(row, data);
            count += 1;
          }
          return { count };
        }),
      },
    };

    emailService = { sendPlatformEmail: jest.fn().mockResolvedValue(undefined) };
    tokenService = {
      issueJwtForUser: jest.fn().mockResolvedValue({
        accessToken: 'access',
        refreshToken: 'refresh',
        user: { id: janUser.id },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MagicLinkService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
        { provide: AuthEmailService, useValue: new AuthEmailService({} as EmailService) },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        { provide: TokenService, useValue: tokenService },
      ],
    }).compile();

    service = module.get(MagicLinkService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function sentMail(): { html: string; text: string; subject: string } {
    return emailService.sendPlatformEmail.mock.calls.at(-1)[0];
  }

  function sentCode(): string {
    const match = sentMail().text.match(/:\s*(\d{6})/);
    if (!match) throw new Error(`code missing from email: ${sentMail().text}`);
    return match[1];
  }

  it('signs in with the emailed code, which is stored only as a hash', async () => {
    const result = await service.requestMagicLink({ email: 'jan@x.com' });
    expect(result).toEqual(SUCCESS);

    const code = sentCode();
    expect(code).toBe('482913');
    const row = rows[0];
    expect(row.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.codeSalt).toBeTruthy();
    for (const value of Object.values(row)) {
      expect(value).not.toBe(code);
    }
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + MAGIC_LINK_TTL_MS + 1000);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + MAGIC_LINK_TTL_MS - 5000);

    const { html, text, subject } = sentMail();
    expect(subject).toBe('Je inlogcode voor OpenCoop');
    expect(html).toContain(row.token);
    expect(html).toContain('Je inlogcode: 482913');
    expect(html).not.toContain('letter-spacing');
    expect(text).toContain('Je inlogcode: 482913');
    expect(text).toContain(row.token);
    expect(html).not.toMatch(/[—–]/);
    expect(text).not.toMatch(/[—–]/);

    const session = await service.verifyMagicLinkCode({
      email: 'jan@x.com',
      code: '48 29 13',
    });
    expect(session).toEqual(expect.objectContaining({ accessToken: 'access' }));
    expect(row.usedAt).toBeInstanceOf(Date);
    expect(tokenService.issueJwtForUser).toHaveBeenCalledTimes(1);
  });

  it('signs the per-admin permission override into the token on magic-link login', async () => {
    const admin = {
      ...janUser,
      id: 'admin-id',
      email: 'admin@x.com',
      role: 'COOP_ADMIN',
      coopAdminOf: [
        {
          coopId: 'coop-1',
          permissionOverrides: { canViewPII: false },
          roles: [{ role: { permissions: { canViewPII: true, canManageSettings: true } } }],
        },
      ],
    };
    usersByEmail['admin@x.com'] = admin;
    usersById[admin.id] = admin;

    const signed: any[] = [];
    const real = new RealTokenService(
      { refreshToken: { create: jest.fn().mockResolvedValue({ id: 'sess-1' }) } } as any,
      { sign: (payload: any) => (signed.push(payload), 'jwt') } as any,
    );
    tokenService.issueJwtForUser.mockImplementation((user: any) => real.issueJwtForUser(user));

    await service.requestMagicLink({ email: 'admin@x.com' });
    await service.verifyMagicLinkCode({ email: 'admin@x.com', code: '482913' });

    expect(signed).toHaveLength(1);
    expect(signed[0].coopPermissions['coop-1']).toEqual(
      expect.objectContaining({ canViewPII: false, canManageSettings: true }),
    );
  });

  it('locks the code after 5 wrong attempts and leaves the link usable', async () => {
    await service.requestMagicLink({ email: 'jan@x.com' });
    const row = rows[0];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        service.verifyMagicLinkCode({ email: 'jan@x.com', code: '000000' }),
      ).rejects.toThrow(new BadRequestException(MAGIC_LINK_CODE_INVALID));
    }
    await expect(
      service.verifyMagicLinkCode({ email: 'jan@x.com', code: '000000' }),
    ).rejects.toThrow(new BadRequestException(MAGIC_LINK_CODE_LOCKED));
    await expect(
      service.verifyMagicLinkCode({ email: 'jan@x.com', code: '482913' }),
    ).rejects.toThrow(new BadRequestException(MAGIC_LINK_CODE_LOCKED));

    expect(row.failedAttempts).toBe(5);
    expect(row.usedAt).toBeNull();
    expect(tokenService.issueJwtForUser).not.toHaveBeenCalled();

    await service.verifyMagicLink({ token: row.token });
    expect(row.usedAt).toBeInstanceOf(Date);
    expect(tokenService.issueJwtForUser).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired code and an expired link without consuming either', async () => {
    await service.requestMagicLink({ email: 'jan@x.com' });
    const row = rows[0];
    row.expiresAt = new Date(Date.now() - 1000);

    await expect(
      service.verifyMagicLinkCode({ email: 'jan@x.com', code: '482913' }),
    ).rejects.toThrow(new BadRequestException(MAGIC_LINK_CODE_EXPIRED));
    await expect(service.verifyMagicLink({ token: row.token })).rejects.toThrow(
      new BadRequestException(MAGIC_LINK_EXPIRED),
    );

    expect(row.usedAt).toBeNull();
    expect(tokenService.issueJwtForUser).not.toHaveBeenCalled();
  });

  it('lets the code and the link consume each other', async () => {
    await service.requestMagicLink({ email: 'jan@x.com' });
    const byCode = rows[0];
    await service.verifyMagicLinkCode({ email: 'jan@x.com', code: '482913' });
    await expect(service.verifyMagicLink({ token: byCode.token })).rejects.toThrow(
      new BadRequestException(MAGIC_LINK_USED),
    );

    await service.requestMagicLink({ email: 'jan@x.com' });
    const byLink = rows[1];
    await service.verifyMagicLink({ token: byLink.token });
    await expect(
      service.verifyMagicLinkCode({ email: 'jan@x.com', code: '482913' }),
    ).rejects.toThrow(new BadRequestException(MAGIC_LINK_USED));

    expect(tokenService.issueJwtForUser).toHaveBeenCalledTimes(2);
    expect(byCode.usedAt).toBeInstanceOf(Date);
    expect(byLink.usedAt).toBeInstanceOf(Date);
  });

  it('rate limits requests per email and answers with the same generic body', async () => {
    for (let i = 0; i < 3; i += 1) {
      await expect(service.requestMagicLink({ email: 'jan@x.com' })).resolves.toEqual(SUCCESS);
    }
    await expect(service.requestMagicLink({ email: 'jan@x.com' })).resolves.toEqual(SUCCESS);
    expect(emailService.sendPlatformEmail).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(3);

    await expect(service.requestMagicLink({ email: 'other@x.com' })).resolves.toEqual(SUCCESS);
    expect(emailService.sendPlatformEmail).toHaveBeenCalledTimes(4);
    expect(rows.filter((row) => row.email === 'other@x.com')).toHaveLength(1);

    for (const row of rows.filter((item) => item.email === 'jan@x.com')) {
      row.createdAt = new Date(Date.now() - 16 * 60 * 1000);
    }
    await expect(service.requestMagicLink({ email: 'jan@x.com' })).resolves.toEqual(SUCCESS);
    expect(emailService.sendPlatformEmail).toHaveBeenCalledTimes(5);
  });

  it('does not reveal whether an email has an account', async () => {
    const known = await service.requestMagicLink({ email: 'Jan@x.com' });
    const unknown = await service.requestMagicLink({ email: 'nobody@x.com' });

    expect(known).toEqual(unknown);
    expect(known).toEqual(SUCCESS);
    expect(known).not.toHaveProperty('code');
    expect(known).not.toHaveProperty('token');
    expect(emailService.sendPlatformEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendPlatformEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jan@x.com', templateKey: 'magic-link' }),
    );
  });

  it('keeps magic-link copy free of em and en dashes in every language', () => {
    const authEmail = new AuthEmailService({} as EmailService);
    for (const lang of ['nl', 'en', 'fr', 'de', undefined]) {
      const copy = authEmail.getMagicLinkContent(lang, 'Zonnecoop');
      const text = Object.values(copy).join('\n');
      expect(text).not.toMatch(/[—–]/);
      expect(copy.expiry).toContain('10');
      expect(copy.codeLine).toContain('{code}');
      expect(copy.subject.toLowerCase()).toMatch(/code|inlogcode|anmeldecode/);
    }
    const lines: Record<string, string> = {
      en: 'Your sign-in code: 123456',
      nl: 'Je inlogcode: 123456',
      fr: 'Votre code de connexion : 123456',
      de: 'Ihr Anmeldecode: 123456',
    };
    expect(authEmail.getMagicLinkContent('en', 'OpenCoop').subject).toBe('Your OpenCoop sign-in code');
    expect(authEmail.getMagicLinkContent('nl', 'OpenCoop').subject).toBe('Je inlogcode voor OpenCoop');
    expect(authEmail.getMagicLinkContent('fr', 'OpenCoop').subject).toBe('Votre code de connexion pour OpenCoop');
    expect(authEmail.getMagicLinkContent('de', 'OpenCoop').subject).toBe('Ihr Anmeldecode für OpenCoop');
    expect(authEmail.getMagicLinkContent('en', 'OpenCoop').codeLine.replace('{code}', '123456')).toBe(lines.en);
    expect(authEmail.getMagicLinkContent('nl', 'OpenCoop').codeLine.replace('{code}', '123456')).toBe(lines.nl);
    expect(authEmail.getMagicLinkContent('fr', 'OpenCoop').codeLine.replace('{code}', '123456')).toBe(lines.fr);
    expect(authEmail.getMagicLinkContent('de', 'OpenCoop').codeLine.replace('{code}', '123456')).toBe(lines.de);
    for (const lang of ['nl', 'en', 'fr', 'de']) {
      const copy = buildCopy('magic-link', lang, { coopName: 'Zonnecoop' });
      const text = Object.values(copy).join('\n');
      expect(text).not.toMatch(/[—–]/);
      expect(copy.expires).toContain('10');
      expect(copy.codeLine.replace('{code}', '123456')).toBe(lines[lang]);
    }
  });
});
