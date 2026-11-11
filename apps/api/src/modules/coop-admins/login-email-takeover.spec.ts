// No real mail leaves a test: the mailer module is replaced before any import.
jest.mock('../email/email.service', () => ({
  EmailService: class EmailServiceMock {
    sendPlatformEmail = jest.fn().mockResolvedValue(undefined);
  },
}));
jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { CoopAdminsService } from './coop-admins.service';
import { MagicLinkService } from '../auth/magic-link.service';
import { AuthEmailService } from '../auth/auth-email.service';
import * as codeModule from '../auth/magic-link-code';

/**
 * Account takeover through the team page: a coop admin rewrites another
 * member's login email to an address they control, then asks for a magic
 * link to that address. The tests drive the real services over one shared
 * in-memory store, so the second step sees what the first one wrote.
 */

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: 'SHAREHOLDER' | 'COOP_ADMIN' | 'SYSTEM_ADMIN';
  preferredLanguage: string;
  emailVerified: Date | null;
  mfaEnabled: boolean;
  passwordResetToken?: string | null;
};
type RefreshRow = { id: string; userId: string; revokedAt: Date | null };
type AdminRow = { id: string; coopId: string; userId: string; manager: boolean };
type ShareholderRow = {
  id: string;
  coopId: string;
  email: string | null;
  userId: string | null;
  firstName: string;
  lastName: string;
};
type TokenRow = {
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

const COOP = 'coop-a';
const OTHER_COOP = 'coop-b';
const ATTACKER_ADDRESS = 'attacker@example.test';
const VERIFIED_AT = new Date('2026-01-01T00:00:00Z');

function pick<T extends Record<string, any>>(row: T, select?: Record<string, boolean>) {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) if (select[key]) out[key] = row[key];
  return out;
}

function tokenMatches(row: TokenRow, where: any): boolean {
  for (const [key, value] of Object.entries(where ?? {})) {
    const current = (row as any)[key];
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const bound = value as { gte?: Date; gt?: Date; lt?: number };
      if (bound.gte !== undefined && !(current >= bound.gte)) return false;
      if (bound.gt !== undefined && !(current > bound.gt)) return false;
      if (bound.lt !== undefined && !(current < bound.lt)) return false;
    } else if (current !== value) {
      return false;
    }
  }
  return true;
}

function shareholderMatches(row: ShareholderRow, where: any): boolean {
  if (where.userId !== undefined && row.userId !== where.userId) return false;
  if (where.email?.equals !== undefined) {
    if ((row.email ?? '').toLowerCase() !== String(where.email.equals).toLowerCase()) return false;
  }
  return true;
}

function createStore() {
  const users = new Map<string, UserRow>();
  const admins: AdminRow[] = [];
  const shareholders: ShareholderRow[] = [];
  const tokens: TokenRow[] = [];
  const refreshTokens: RefreshRow[] = [];

  const managerRole = { role: { permissions: { canManageAdmins: true } } };
  const viewerRole = { role: { permissions: { canManageAdmins: false } } };
  const withRoles = (a: AdminRow) => ({ ...a, roles: [a.manager ? managerRole : viewerRole] });
  const userByEmail = (email: string) => [...users.values()].find((u) => u.email === email) ?? null;
  const withUser = (row: TokenRow) => ({
    ...row,
    user: { ...users.get(row.userId)!, coopAdminOf: [] },
  });

  const prisma = {
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    refreshToken: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hits = refreshTokens.filter(
          (r) => r.userId === where.userId && (where.revokedAt !== null || r.revokedAt === null),
        );
        hits.forEach((r) => Object.assign(r, data));
        return { count: hits.length };
      }),
    },
    user: {
      findUnique: jest.fn(async ({ where, select }: any) => {
        const user = where.id ? users.get(where.id) : userByEmail(where.email);
        return user ? pick(user, select) : null;
      }),
      update: jest.fn(async ({ where, data, select }: any) => {
        const user = users.get(where.id);
        if (!user) throw new Error('user not found');
        Object.assign(user, data);
        return pick(user, select);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const user = users.get(where.id);
        if (!user || (where.role !== undefined && user.role !== where.role)) return { count: 0 };
        Object.assign(user, data);
        return { count: 1 };
      }),
      create: jest.fn(async ({ data }: any) => {
        const user: UserRow = {
          id: `user-${users.size + 1}`,
          name: null,
          role: 'SHAREHOLDER',
          preferredLanguage: 'nl',
          emailVerified: null,
          mfaEnabled: false,
          ...data,
        };
        users.set(user.id, user);
        return user;
      }),
    },
    coopAdmin: {
      findFirst: jest.fn(async ({ where, include }: any) => {
        const admin = admins.find((a) => a.id === where.id && a.coopId === where.coopId);
        if (!admin) return null;
        const user = users.get(admin.userId)!;
        return {
          ...withRoles(admin),
          ...(include?.user && { user: pick(user, include.user.select) }),
        };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        admins.filter((a) => a.coopId === where.coopId).map(withRoles),
      ),
      delete: jest.fn(async ({ where }: any) => {
        const index = admins.findIndex((a) => a.id === where.id);
        return admins.splice(index, 1)[0];
      }),
      count: jest.fn(
        async ({ where }: any) => admins.filter((a) => a.userId === where.userId).length,
      ),
    },
    shareholder: {
      findFirst: jest.fn(
        async ({ where }: any) => shareholders.find((s) => shareholderMatches(s, where)) ?? null,
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hits = shareholders.filter((s) => shareholderMatches(s, where));
        hits.forEach((s) => Object.assign(s, data));
        return { count: hits.length };
      }),
    },
    channel: { findFirst: jest.fn().mockResolvedValue(null) },
    magicLinkToken: {
      count: jest.fn(async ({ where }: any) => tokens.filter((t) => tokenMatches(t, where)).length),
      create: jest.fn(async ({ data }: any) => {
        const row: TokenRow = {
          id: `tok-${tokens.length + 1}`,
          failedAttempts: 0,
          usedAt: null,
          createdAt: new Date(),
          codeHash: null,
          codeSalt: null,
          ...data,
        };
        tokens.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = tokens.find((t) => tokenMatches(t, where));
        return row ? withUser(row) : null;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const found = tokens
          .filter((t) => tokenMatches(t, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return found[0] ? withUser(found[0]) : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        tokens
          .filter((t) => tokenMatches(t, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(withUser),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of tokens) {
          if (!tokenMatches(row, where)) continue;
          for (const [key, value] of Object.entries(data)) {
            (row as any)[key] =
              value && typeof value === 'object' && 'increment' in (value as any)
                ? ((row as any)[key] ?? 0) + (value as any).increment
                : value;
          }
          count += 1;
        }
        return { count };
      }),
    },
  };

  return { prisma, users, admins, shareholders, tokens, refreshTokens };
}

describe('Team member login email cannot be hijacked by a coop admin', () => {
  let store: ReturnType<typeof createStore>;
  let coopAdmins: CoopAdminsService;
  let magicLinks: MagicLinkService;
  let mailer: { sendPlatformEmail: jest.Mock };
  let tokenService: { issueJwtForUser: jest.Mock };

  beforeEach(() => {
    jest.spyOn(codeModule, 'generateLoginCode').mockReturnValue('482913');
    store = createStore();

    // Fictional people only. Acting coop admin, a fellow team member who is
    // also an admin in another coop, a system admin on the team, a plain admin.
    const people: UserRow[] = [
      {
        id: 'actor',
        email: 'actor@example.test',
        name: 'Acting Admin',
        role: 'COOP_ADMIN',
        preferredLanguage: 'nl',
        emailVerified: VERIFIED_AT,
        mfaEnabled: false,
      },
      {
        id: 'victim',
        email: 'member@example.test',
        name: 'Team Member',
        role: 'COOP_ADMIN',
        preferredLanguage: 'en',
        emailVerified: VERIFIED_AT,
        mfaEnabled: false,
      },
      {
        id: 'sysadmin',
        email: 'platform@example.test',
        name: 'Platform Admin',
        role: 'SYSTEM_ADMIN',
        preferredLanguage: 'nl',
        emailVerified: VERIFIED_AT,
        mfaEnabled: false,
      },
      {
        id: 'plain',
        email: 'plain@example.test',
        name: 'Plain Admin',
        role: 'COOP_ADMIN',
        preferredLanguage: 'nl',
        emailVerified: VERIFIED_AT,
        mfaEnabled: false,
      },
    ];
    people.forEach((p) => store.users.set(p.id, p));
    store.admins.push(
      { id: 'adm-actor', coopId: COOP, userId: 'actor', manager: true },
      { id: 'adm-victim', coopId: COOP, userId: 'victim', manager: false },
      { id: 'adm-victim-b', coopId: OTHER_COOP, userId: 'victim', manager: true },
      { id: 'adm-sys', coopId: COOP, userId: 'sysadmin', manager: false },
      { id: 'adm-plain', coopId: COOP, userId: 'plain', manager: false },
    );
    store.shareholders.push({
      id: 'sh-victim',
      coopId: COOP,
      email: 'member@example.test',
      userId: 'victim',
      firstName: 'Team',
      lastName: 'Member',
    });

    mailer = { sendPlatformEmail: jest.fn().mockResolvedValue(undefined) };
    tokenService = {
      issueJwtForUser: jest.fn(async (user: { id: string }) => ({
        accessToken: `jwt-for-${user.id}`,
      })),
    };
    coopAdmins = new CoopAdminsService(store.prisma as any, mailer as any);
    magicLinks = new MagicLinkService(
      store.prisma as any,
      mailer as any,
      new AuthEmailService(mailer as any),
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      tokenService as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const mailTo = (address: string) =>
    mailer.sendPlatformEmail.mock.calls.filter(([msg]) => msg.to === address);

  describe('attack', () => {
    it('rejects a coop admin changing another member login email', async () => {
      await expect(
        coopAdmins.updateAdminUser(COOP, 'adm-victim', { email: ATTACKER_ADDRESS }, 'COOP_ADMIN'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const victim = store.users.get('victim')!;
      expect(victim.email).toBe('member@example.test');
      expect(victim.emailVerified).toEqual(VERIFIED_AT);
    });

    it('rejects a coop admin changing their own login email through the team page', async () => {
      await expect(
        coopAdmins.updateAdminUser(
          COOP,
          'adm-actor',
          { email: 'actor.new@example.test' },
          'COOP_ADMIN',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(store.users.get('actor')!.email).toBe('actor@example.test');
    });

    it('rejects the change even when it rides along with allowed fields', async () => {
      await expect(
        coopAdmins.updateAdminUser(
          COOP,
          'adm-victim',
          { name: 'Renamed', email: ATTACKER_ADDRESS },
          'COOP_ADMIN',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(store.users.get('victim')).toMatchObject({
        name: 'Team Member',
        email: 'member@example.test',
      });
    });

    it('gives the attacker no way to sign in as the member with a magic link', async () => {
      await coopAdmins
        .updateAdminUser(COOP, 'adm-victim', { email: ATTACKER_ADDRESS }, 'COOP_ADMIN')
        .catch(() => undefined);

      // Same reply as for a real account, so the response leaks nothing.
      await expect(magicLinks.requestMagicLink({ email: ATTACKER_ADDRESS })).resolves.toEqual({
        message: expect.any(String),
      });

      expect(store.tokens.filter((t) => t.userId === 'victim')).toHaveLength(0);
      expect(mailTo(ATTACKER_ADDRESS)).toHaveLength(0);
      await expect(
        magicLinks.verifyMagicLinkCode({ email: ATTACKER_ADDRESS, code: '482913' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tokenService.issueJwtForUser).not.toHaveBeenCalled();
    });

    it('does not turn a member contact email into a login for the member account', async () => {
      // The shareholder contact address is a separate field an admin may edit.
      store.shareholders[0].email = ATTACKER_ADDRESS;

      await magicLinks.requestMagicLink({ email: ATTACKER_ADDRESS });

      expect(store.tokens).toHaveLength(0);
      expect(mailTo(ATTACKER_ADDRESS)).toHaveLength(0);
      expect(store.shareholders[0].userId).toBe('victim');
      expect(tokenService.issueJwtForUser).not.toHaveBeenCalled();
    });
  });

  describe('system admin protection', () => {
    it('rejects a coop admin editing any field of a system admin', async () => {
      await expect(
        coopAdmins.updateAdminUser(COOP, 'adm-sys', { name: 'Hijacked' }, 'COOP_ADMIN'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        coopAdmins.updateAdminUser(COOP, 'adm-sys', { email: ATTACKER_ADDRESS }, 'COOP_ADMIN'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(store.users.get('sysadmin')).toMatchObject({
        name: 'Platform Admin',
        email: 'platform@example.test',
        role: 'SYSTEM_ADMIN',
      });
    });

    it('never demotes a system admin when a coop admin removes them from the team', async () => {
      await coopAdmins.removeAdmin(COOP, 'adm-sys');

      expect(store.admins.find((a) => a.id === 'adm-sys')).toBeUndefined();
      expect(store.users.get('sysadmin')!.role).toBe('SYSTEM_ADMIN');
    });
  });

  describe('legitimate flows', () => {
    it('lets a coop admin edit the name and language of a team member', async () => {
      const result = await coopAdmins.updateAdminUser(
        COOP,
        'adm-victim',
        { name: 'Renamed Member', preferredLanguage: 'fr' },
        'COOP_ADMIN',
      );

      expect(result).toMatchObject({
        name: 'Renamed Member',
        preferredLanguage: 'fr',
        email: 'member@example.test',
      });
      expect(store.users.get('victim')!.emailVerified).toEqual(VERIFIED_AT);
    });

    it('accepts the unchanged email in a different case as a no-op', async () => {
      const result = await coopAdmins.updateAdminUser(
        COOP,
        'adm-victim',
        { name: 'Renamed Member', email: ' Member@Example.TEST ' },
        'COOP_ADMIN',
      );

      expect(result).toMatchObject({ name: 'Renamed Member', email: 'member@example.test' });
      expect(store.users.get('victim')!.emailVerified).toEqual(VERIFIED_AT);
    });

    it('lets a system admin change a login email, which forces re-verification', async () => {
      const result = await coopAdmins.updateAdminUser(
        COOP,
        'adm-plain',
        { email: 'Plain.New@example.test' },
        'SYSTEM_ADMIN',
      );

      expect(result).toMatchObject({ email: 'plain.new@example.test', emailVerified: null });
    });

    it('lets a system admin edit another system admin', async () => {
      await expect(
        coopAdmins.updateAdminUser(COOP, 'adm-sys', { name: 'Platform Ops' }, 'SYSTEM_ADMIN'),
      ).resolves.toMatchObject({ name: 'Platform Ops' });
    });

    it('rejects a system admin moving a login onto an address another account uses', async () => {
      await expect(
        coopAdmins.updateAdminUser(
          COOP,
          'adm-plain',
          { email: 'member@example.test' },
          'SYSTEM_ADMIN',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(store.users.get('plain')!.email).toBe('plain@example.test');
    });

    it('retires links and sessions of the old address when a system admin changes it', async () => {
      await magicLinks.requestMagicLink({ email: 'plain@example.test' });
      store.users.get('plain')!.passwordResetToken = 'hashed-reset-token';
      store.refreshTokens.push({ id: 'rt-1', userId: 'plain', revokedAt: null });

      await coopAdmins.updateAdminUser(
        COOP,
        'adm-plain',
        { email: 'plain.new@example.test' },
        'SYSTEM_ADMIN',
      );

      await expect(
        magicLinks.verifyMagicLinkCode({ email: 'plain@example.test', code: '482913' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tokenService.issueJwtForUser).not.toHaveBeenCalled();
      expect(store.users.get('plain')!.passwordResetToken).toBeNull();
      expect(store.refreshTokens[0].revokedAt).toBeInstanceOf(Date);
    });

    it('signs nobody out when only name or language changes', async () => {
      store.refreshTokens.push({ id: 'rt-2', userId: 'victim', revokedAt: null });

      await coopAdmins.updateAdminUser(COOP, 'adm-victim', { name: 'Renamed' }, 'COOP_ADMIN');

      expect(store.refreshTokens[0].revokedAt).toBeNull();
    });

    it('still demotes a regular coop admin removed from their last team', async () => {
      await coopAdmins.removeAdmin(COOP, 'adm-plain');

      expect(store.users.get('plain')!.role).toBe('SHAREHOLDER');
    });

    it('keeps the member own magic-link sign-in working after a rejected attempt', async () => {
      await coopAdmins
        .updateAdminUser(COOP, 'adm-victim', { email: ATTACKER_ADDRESS }, 'COOP_ADMIN')
        .catch(() => undefined);

      await magicLinks.requestMagicLink({ email: 'member@example.test' });
      expect(mailTo('member@example.test')).toHaveLength(1);

      await magicLinks.verifyMagicLinkCode({ email: 'member@example.test', code: '482913' });
      expect(tokenService.issueJwtForUser).toHaveBeenCalledTimes(1);
      expect(tokenService.issueJwtForUser.mock.calls[0][0]).toMatchObject({ id: 'victim' });
    });
  });
});

describe('UpdateAdminUserDto', () => {
  const errorsFor = (body: Record<string, unknown>) =>
    validate(plainToInstance(UpdateAdminUserDto, body)).then((errors) =>
      errors.map((e) => e.property),
    );

  it('accepts the body the team page sends', async () => {
    await expect(errorsFor({ name: null, preferredLanguage: 'nl' })).resolves.toEqual([]);
    await expect(errorsFor({ name: 'New Name', preferredLanguage: 'de' })).resolves.toEqual([]);
  });

  it('rejects extra fields under the global validation pipe settings', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const metadata = { type: 'body' as const, metatype: UpdateAdminUserDto };
    await expect(
      pipe.transform({ name: 'Ok', role: 'SYSTEM_ADMIN' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ emailVerified: null }, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a malformed email, an unknown language and an oversized name', async () => {
    await expect(errorsFor({ email: { $ne: '' } })).resolves.toEqual(['email']);
    await expect(errorsFor({ email: 'not-an-address' })).resolves.toEqual(['email']);
    await expect(errorsFor({ preferredLanguage: 'xx' })).resolves.toEqual(['preferredLanguage']);
    await expect(errorsFor({ name: 'x'.repeat(101) })).resolves.toEqual(['name']);
  });
});
