// No real mail leaves a test: the mailer module is replaced before any import.
jest.mock('../email/email.service', () => ({
  EmailService: class EmailServiceMock {
    sendPlatformEmail = jest.fn().mockResolvedValue(undefined);
  },
}));
jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));
jest.mock('../coops/coops.service', () => ({
  CoopsService: class CoopsServiceMock {},
}));

import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CoopGuard } from '../../common/guards/coop.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthController } from '../auth/auth.controller';
import { AuthEmailService } from '../auth/auth-email.service';
import { AuthService } from '../auth/auth.service';
import { EmancipationService } from '../auth/emancipation.service';
import { MagicLinkService } from '../auth/magic-link.service';
import * as codeModule from '../auth/magic-link-code';
import { MfaService } from '../auth/mfa.service';
import { OAuthService } from '../auth/oauth.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { TokenService } from '../auth/token.service';
import { WebAuthnService } from '../auth/webauthn.service';
import { CoopsService } from '../coops/coops.service';
import { EmailService } from '../email/email.service';
import { UsersService } from '../users/users.service';
import { CoopAdminsController } from './coop-admins.controller';
import { CoopAdminsService } from './coop-admins.service';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

/**
 * Account takeover through the team page: a coop admin rewrites another
 * member's login email to an address they control, then asks for a magic
 * link to that address. These tests go through the real HTTP routes, the
 * real JWT strategy and guards, the global ValidationPipe settings, and the
 * real CoopAdminsService, AuthService and MagicLinkService. Only Prisma (one
 * shared in-memory store) and the mailer are fakes. All people are fictional.
 */

const JWT_SECRET = 'test-only-secret';
const COOP = 'coop-a';
const OTHER_COOP = 'coop-b';
const ATTACKER = 'attacker@example.test';
const NEW_ADDRESS = 'plain.new@example.test';
const VERIFIED_AT = new Date('2026-01-01T00:00:00Z');
const CODE = '482913';

type Role = 'SHAREHOLDER' | 'COOP_ADMIN' | 'SYSTEM_ADMIN';
type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  preferredLanguage: string;
  emailVerified: Date | null;
  emailVerifyToken: string | null;
  emailVerifyExpires: Date | null;
  pendingEmail: string | null;
  passwordResetToken: string | null;
  passwordResetExpires: Date | null;
  mfaEnabled: boolean;
};
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
type RefreshRow = { id: string; userId: string; revokedAt: Date | null };

function pick<T extends Record<string, any>>(row: T, select?: Record<string, boolean>) {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) if (select[key]) out[key] = row[key];
  return out;
}

/** Equality, `{ gt }`, `{ gte }`, `{ lt }` and `null` filters: what these services use. */
function matches(row: Record<string, any>, where: Record<string, any> = {}): boolean {
  for (const [key, value] of Object.entries(where)) {
    const current = row[key];
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('equals' in value) {
        if (String(current ?? '').toLowerCase() !== String(value.equals).toLowerCase())
          return false;
        continue;
      }
      if (value.gte !== undefined && !(current >= value.gte)) return false;
      if (value.gt !== undefined && !(current > value.gt)) return false;
      if (value.lt !== undefined && !(current < value.lt)) return false;
    } else if (current !== value) {
      return false;
    }
  }
  return true;
}

function apply(row: Record<string, any>, data: Record<string, any>) {
  for (const [key, value] of Object.entries(data)) {
    row[key] =
      value && typeof value === 'object' && 'increment' in value
        ? (row[key] ?? 0) + value.increment
        : value;
  }
}

const state = {
  users: new Map<string, UserRow>(),
  admins: [] as AdminRow[],
  shareholders: [] as ShareholderRow[],
  tokens: [] as TokenRow[],
  refreshTokens: [] as RefreshRow[],
};

function person(id: string, email: string, role: Role, name: string): UserRow {
  return {
    id,
    email,
    name,
    role,
    preferredLanguage: 'en',
    emailVerified: VERIFIED_AT,
    emailVerifyToken: null,
    emailVerifyExpires: null,
    pendingEmail: null,
    passwordResetToken: null,
    passwordResetExpires: null,
    mfaEnabled: false,
  };
}

function resetState() {
  state.users = new Map(
    [
      person('actor', 'actor@example.test', 'COOP_ADMIN', 'Acting Admin'),
      person('victim', 'member@example.test', 'COOP_ADMIN', 'Team Member'),
      person('sysadmin', 'platform@example.test', 'SYSTEM_ADMIN', 'Platform Admin'),
      person('plain', 'plain@example.test', 'COOP_ADMIN', 'Plain Admin'),
      person('outsider', 'outsider@example.test', 'COOP_ADMIN', 'Other Coop Admin'),
    ].map((u) => [u.id, u]),
  );
  state.admins = [
    { id: 'adm-actor', coopId: COOP, userId: 'actor', manager: true },
    { id: 'adm-victim', coopId: COOP, userId: 'victim', manager: false },
    { id: 'adm-victim-b', coopId: OTHER_COOP, userId: 'victim', manager: true },
    { id: 'adm-sys', coopId: COOP, userId: 'sysadmin', manager: false },
    { id: 'adm-plain', coopId: COOP, userId: 'plain', manager: false },
    { id: 'adm-outsider', coopId: OTHER_COOP, userId: 'outsider', manager: true },
  ];
  state.shareholders = [
    {
      id: 'sh-victim',
      coopId: COOP,
      email: 'member@example.test',
      userId: 'victim',
      firstName: 'Team',
      lastName: 'Member',
    },
  ];
  state.tokens = [];
  state.refreshTokens = [];
}

const managerRole = { role: { permissions: { canManageAdmins: true } } };
const viewerRole = { role: { permissions: { canManageAdmins: false } } };
const withRoles = (a: AdminRow) => ({ ...a, roles: [a.manager ? managerRole : viewerRole] });
const userByEmail = (email: string) =>
  [...state.users.values()].find((u) => u.email === email) ?? null;
const withUser = (row: TokenRow) => ({
  ...row,
  user: { ...state.users.get(row.userId)!, coopAdminOf: [] },
});

/** Runs only when awaited, like a PrismaPromise, so $transaction can roll back. */
function lazy<T>(run: () => Promise<T>): any {
  let started: Promise<T> | undefined;
  return {
    then: (ok?: (v: T) => unknown, fail?: (e: unknown) => unknown) =>
      (started ??= run()).then(ok, fail),
  };
}

const prisma = {
  // All-or-nothing over the in-memory store: snapshot, run in order, restore
  // on the first failure. It proves which writes share one transaction; it
  // does not prove PostgreSQL isolation.
  $transaction: jest.fn(async (ops: PromiseLike<unknown>[]) => {
    const snapshot = structuredClone({
      users: state.users,
      tokens: state.tokens,
      refreshTokens: state.refreshTokens,
    });
    try {
      const results: unknown[] = [];
      for (const op of ops) results.push(await op);
      return results;
    } catch (err) {
      Object.assign(state, snapshot);
      throw err;
    }
  }),
  user: {
    findUnique: jest.fn(async ({ where, select, include }: any) => {
      const user = where.id ? state.users.get(where.id) : userByEmail(where.email);
      if (!user) return null;
      // getProfile's include: these users hold no shares and no coop rows.
      if (include)
        return { ...user, shareholders: [], coopAdminOf: [], registeredShareholders: [] };
      return pick(user, select);
    }),
    findFirst: jest.fn(
      async ({ where }: any) => [...state.users.values()].find((u) => matches(u, where)) ?? null,
    ),
    update: jest.fn(async ({ where, data, select }: any) => {
      const user = state.users.get(where.id);
      if (!user) throw new Error('user not found');
      if (data.email && userByEmail(data.email) && userByEmail(data.email)!.id !== user.id) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on email', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }
      apply(user, data);
      return pick(user, select);
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hits = [...state.users.values()].filter((u) => matches(u, where));
      hits.forEach((u) => apply(u, data));
      return { count: hits.length };
    }),
    create: jest.fn(async ({ data }: any) => {
      const user = {
        ...person(`user-${state.users.size + 1}`, data.email, 'SHAREHOLDER', data.name),
        ...data,
      };
      state.users.set(user.id, user);
      return user;
    }),
  },
  coopAdmin: {
    findFirst: jest.fn(async ({ where, include }: any) => {
      const admin = state.admins.find((a) => a.id === where.id && a.coopId === where.coopId);
      if (!admin) return null;
      const user = state.users.get(admin.userId)!;
      return {
        ...withRoles(admin),
        ...(include?.user && { user: pick(user, include.user.select) }),
      };
    }),
    findMany: jest.fn(async ({ where }: any) =>
      state.admins.filter((a) => a.coopId === where.coopId).map(withRoles),
    ),
    delete: jest.fn(
      async ({ where }: any) =>
        state.admins.splice(
          state.admins.findIndex((a) => a.id === where.id),
          1,
        )[0],
    ),
    count: jest.fn(
      async ({ where }: any) => state.admins.filter((a) => a.userId === where.userId).length,
    ),
  },
  shareholder: {
    findFirst: jest.fn(
      async ({ where }: any) => state.shareholders.find((s) => matches(s, where)) ?? null,
    ),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hits = state.shareholders.filter((s) => matches(s, where));
      hits.forEach((s) => apply(s, data));
      return { count: hits.length };
    }),
  },
  channel: { findFirst: jest.fn().mockResolvedValue(null) },
  magicLinkToken: {
    count: jest.fn(async ({ where }: any) => state.tokens.filter((t) => matches(t, where)).length),
    create: jest.fn(async ({ data }: any) => {
      const row: TokenRow = {
        id: `tok-${state.tokens.length + 1}`,
        failedAttempts: 0,
        usedAt: null,
        createdAt: new Date(),
        codeHash: null,
        codeSalt: null,
        ...data,
      };
      state.tokens.push(row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const row = state.tokens.find((t) => matches(t, where));
      return row ? withUser(row) : null;
    }),
    findFirst: jest.fn(async ({ where }: any) => {
      const found = state.tokens
        .filter((t) => matches(t, where))
        .sort((a, b) => +b.createdAt - +a.createdAt);
      return found[0] ? withUser(found[0]) : null;
    }),
    findMany: jest.fn(async ({ where }: any) =>
      state.tokens
        .filter((t) => matches(t, where))
        .sort((a, b) => +b.createdAt - +a.createdAt)
        .map(withUser),
    ),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hits = state.tokens.filter((t) => matches(t, where));
      hits.forEach((t) => apply(t, data));
      return { count: hits.length };
    }),
  },
  refreshToken: {
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hits = state.refreshTokens.filter((r) => matches(r, where));
      hits.forEach((r) => apply(r, data));
      return { count: hits.length };
    }),
  },
};

for (const op of [
  prisma.user.update,
  prisma.user.updateMany,
  prisma.magicLinkToken.updateMany,
  prisma.refreshToken.updateMany,
] as jest.Mock[]) {
  const eager = op.getMockImplementation()!;
  op.mockImplementation((args: unknown) => lazy(() => eager(args)));
}

describe('Team member login email over HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let jwt: JwtService;
  let mailer: { sendPlatformEmail: jest.Mock };
  const audit = {
    log: jest.fn().mockResolvedValue(undefined),
    diff: jest.fn().mockReturnValue([]),
  };
  const tokenService = {
    issueJwtForUser: jest.fn(async (user: { id: string }) => ({
      accessToken: `session-for-${user.id}`,
    })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: JWT_SECRET })],
      controllers: [CoopAdminsController, AuthController],
      providers: [
        JwtStrategy,
        RolesGuard,
        CoopGuard,
        PermissionGuard,
        CoopAdminsService,
        AuthService,
        MagicLinkService,
        AuthEmailService,
        EmailService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'JWT_SECRET' ? JWT_SECRET : undefined) },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: TokenService, useValue: tokenService },
        { provide: UsersService, useValue: {} },
        { provide: CoopsService, useValue: {} },
        { provide: MfaService, useValue: {} },
        { provide: OAuthService, useValue: {} },
        { provide: EmancipationService, useValue: {} },
        { provide: WebAuthnService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Same settings as main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    jwt = moduleRef.get(JwtService);
    mailer = moduleRef.get(EmailService) as unknown as { sendPlatformEmail: jest.Mock };
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetState();
    jest.clearAllMocks();
    mailer.sendPlatformEmail.mockImplementation(async () => undefined);
    jest.spyOn(codeModule, 'generateLoginCode').mockReturnValue(CODE);
  });

  afterEach(() => jest.restoreAllMocks());

  /** Signed like a real access token; the role comes only from here. */
  function bearer(
    userId: string,
    role: Role,
    coopPermissions: Record<string, Record<string, boolean>> = {},
  ) {
    const user = state.users.get(userId)!;
    const token = jwt.sign({
      sub: userId,
      email: user.email,
      role,
      coopIds: Object.keys(coopPermissions),
      coopPermissions,
    });
    return { authorization: `Bearer ${token}` };
  }
  const coopAdmin = () => bearer('actor', 'COOP_ADMIN', { [COOP]: { canManageAdmins: true } });
  const systemAdmin = () => bearer('sysadmin', 'SYSTEM_ADMIN');

  async function call(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }
  const editUser = (adminId: string, headers: Record<string, string>, body: unknown) =>
    call('PATCH', `/admin/coops/${COOP}/team/${adminId}/user`, headers, body);
  const mailsTo = (address: string) =>
    mailer.sendPlatformEmail.mock.calls.map(([m]) => m).filter((m) => m.to === address);
  const verifyTokenIn = (mail: { html: string }) => {
    const match = mail.html.match(/verify-email\?token=([0-9a-f]+)/);
    if (!match) throw new Error('verify link missing from mail');
    return match[1];
  };

  describe('privileges', () => {
    it('rejects a request without a session', async () => {
      const res = await editUser('adm-victim', {}, { name: 'X' });
      expect(res.status).toBe(401);
    });

    it('rejects a coop admin of another coop', async () => {
      const res = await editUser(
        'adm-victim',
        bearer('outsider', 'COOP_ADMIN', { [OTHER_COOP]: { canManageAdmins: true } }),
        {
          name: 'X',
        },
      );
      expect(res.status).toBe(403);
      expect(state.users.get('victim')!.name).toBe('Team Member');
    });

    it('rejects a coop admin without canManageAdmins', async () => {
      const res = await editUser(
        'adm-victim',
        bearer('actor', 'COOP_ADMIN', { [COOP]: { canManageAdmins: false } }),
        {
          name: 'X',
        },
      );
      expect(res.status).toBe(403);
    });

    it('takes the role from the signed session, never from the body', async () => {
      const res = await editUser('adm-victim', coopAdmin(), {
        email: ATTACKER,
        role: 'SYSTEM_ADMIN',
      });
      expect(res.status).toBe(400);
      expect(state.users.get('victim')).toMatchObject({
        email: 'member@example.test',
        pendingEmail: null,
      });
    });
  });

  describe('attack by a coop admin', () => {
    it('rejects a change of another member login email and leaves no pending change', async () => {
      const res = await editUser('adm-victim', coopAdmin(), { name: 'Renamed', email: ATTACKER });

      expect(res.status).toBe(403);
      expect(state.users.get('victim')).toMatchObject({
        name: 'Team Member',
        email: 'member@example.test',
        pendingEmail: null,
        emailVerified: VERIFIED_AT,
      });
      expect(mailer.sendPlatformEmail).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('rejects a change of their own login email through the team page', async () => {
      const res = await editUser('adm-actor', coopAdmin(), { email: 'actor.new@example.test' });
      expect(res.status).toBe(403);
      expect(state.users.get('actor')!.email).toBe('actor@example.test');
    });

    it('gives the attacker no way to sign in as the member with a magic link', async () => {
      await editUser('adm-victim', coopAdmin(), { email: ATTACKER });

      const request = await call('POST', '/auth/magic-link/request', {}, { email: ATTACKER });
      expect(request.status).toBe(201);
      expect(state.tokens.filter((t) => t.userId === 'victim')).toHaveLength(0);
      expect(mailsTo(ATTACKER)).toHaveLength(0);

      const code = await call('POST', '/auth/magic-link/code', {}, { email: ATTACKER, code: CODE });
      expect(code.status).toBe(400);
      expect(tokenService.issueJwtForUser).not.toHaveBeenCalled();
    });

    it('does not turn a member contact email into a login for the member account', async () => {
      state.shareholders[0].email = ATTACKER;

      await call('POST', '/auth/magic-link/request', {}, { email: ATTACKER });

      expect(state.tokens).toHaveLength(0);
      expect(state.shareholders[0].userId).toBe('victim');
      expect(tokenService.issueJwtForUser).not.toHaveBeenCalled();
    });
  });

  describe('system admin protection', () => {
    it('rejects a coop admin editing any field of a system admin', async () => {
      expect((await editUser('adm-sys', coopAdmin(), { name: 'Hijacked' })).status).toBe(403);
      expect((await editUser('adm-sys', coopAdmin(), { email: ATTACKER })).status).toBe(403);
      expect(state.users.get('sysadmin')).toMatchObject({
        name: 'Platform Admin',
        email: 'platform@example.test',
        pendingEmail: null,
      });
    });

    it('never demotes a system admin when a coop admin removes them from the team', async () => {
      const res = await call('DELETE', `/admin/coops/${COOP}/team/adm-sys`, coopAdmin());
      expect(res.status).toBe(200);
      expect(state.admins.find((a) => a.id === 'adm-sys')).toBeUndefined();
      expect(state.users.get('sysadmin')!.role).toBe('SYSTEM_ADMIN');
    });
  });

  describe('system admin change needs proof from the new address', () => {
    it('keeps the old login, mails the verify link to the new address and a notice to the old one', async () => {
      const res = await editUser('adm-plain', systemAdmin(), { email: 'Plain.New@Example.test' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        email: 'plain@example.test',
        pendingEmail: NEW_ADDRESS,
        emailVerified: expect.any(String),
      });
      expect(state.users.get('plain')!.email).toBe('plain@example.test');

      const [verifyMail] = mailsTo(NEW_ADDRESS);
      expect(verifyMail.templateKey).toBe('email-verification');
      const [notice] = mailsTo('plain@example.test');
      expect(notice.templateKey).toBe('login-email-change-notice');
      expect(notice.text).toContain(NEW_ADDRESS);
      expect(notice.html).not.toContain('token=');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'User',
          entityId: 'plain',
          actorId: 'sysadmin',
          changes: [{ field: 'pendingEmail', oldValue: null, newValue: NEW_ADDRESS }],
        }),
      );
    });

    it('does not let the new address sign in before it is verified', async () => {
      await editUser('adm-plain', systemAdmin(), { email: NEW_ADDRESS });

      await call('POST', '/auth/magic-link/request', {}, { email: NEW_ADDRESS });
      expect(state.tokens).toHaveLength(0);
      expect(
        (await call('POST', '/auth/magic-link/code', {}, { email: NEW_ADDRESS, code: CODE }))
          .status,
      ).toBe(400);
      expect(tokenService.issueJwtForUser).not.toHaveBeenCalled();
    });

    it('keeps sign-in with the old address working while the change is pending', async () => {
      await editUser('adm-plain', systemAdmin(), { email: NEW_ADDRESS });

      await call('POST', '/auth/magic-link/request', {}, { email: 'plain@example.test' });
      const res = await call(
        'POST',
        '/auth/magic-link/code',
        {},
        { email: 'plain@example.test', code: CODE },
      );
      expect(res.status).toBe(201);
      expect(tokenService.issueJwtForUser.mock.calls[0][0]).toMatchObject({ id: 'plain' });
    });

    it('rejects a wrong or expired verify token and changes nothing', async () => {
      await editUser('adm-plain', systemAdmin(), { email: NEW_ADDRESS });
      const token = verifyTokenIn(mailsTo(NEW_ADDRESS)[0]);

      expect((await call('GET', '/auth/verify-email?token=deadbeef')).status).toBe(400);
      state.users.get('plain')!.emailVerifyExpires = new Date(Date.now() - 1000);
      expect((await call('GET', `/auth/verify-email?token=${token}`)).status).toBe(400);
      expect(state.users.get('plain')).toMatchObject({
        email: 'plain@example.test',
        pendingEmail: NEW_ADDRESS,
      });
    });

    it('never mails a confirm token to the old address while a change is pending', async () => {
      state.users.get('plain')!.emailVerified = null;
      await editUser('adm-plain', systemAdmin(), { email: NEW_ADDRESS });
      const tokenBefore = state.users.get('plain')!.emailVerifyToken;
      mailer.sendPlatformEmail.mockClear();

      const res = await call('POST', '/auth/resend-verification', bearer('plain', 'COOP_ADMIN'));

      expect(res.status).toBe(201);
      expect(mailer.sendPlatformEmail).not.toHaveBeenCalled();
      expect(state.users.get('plain')!.emailVerifyToken).toBe(tokenBefore);
    });

    it('switches the login once the new address verifies, and retires what the old one had', async () => {
      await call('POST', '/auth/magic-link/request', {}, { email: 'plain@example.test' });
      state.users.get('plain')!.passwordResetToken = 'hashed-reset-token';
      state.refreshTokens.push({ id: 'rt-1', userId: 'plain', revokedAt: null });
      await editUser('adm-plain', systemAdmin(), { email: NEW_ADDRESS });
      audit.log.mockClear();

      const res = await call(
        'GET',
        `/auth/verify-email?token=${verifyTokenIn(mailsTo(NEW_ADDRESS)[0])}`,
      );

      expect(res.status).toBe(200);
      expect(state.users.get('plain')).toMatchObject({
        email: NEW_ADDRESS,
        pendingEmail: null,
        emailVerifyToken: null,
        passwordResetToken: null,
        emailVerified: expect.any(Date),
      });
      expect(state.refreshTokens[0].revokedAt).toBeInstanceOf(Date);
      expect(
        (
          await call(
            'POST',
            '/auth/magic-link/code',
            {},
            { email: 'plain@example.test', code: CODE },
          )
        ).status,
      ).toBe(400);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'plain',
          changes: [{ field: 'email', oldValue: 'plain@example.test', newValue: NEW_ADDRESS }],
        }),
      );

      // The verify link is single use.
      expect(
        (await call('GET', `/auth/verify-email?token=${verifyTokenIn(mailsTo(NEW_ADDRESS)[0])}`))
          .status,
      ).toBe(400);
    });

    it('drops the pending change if another account took the address before verification', async () => {
      await editUser('adm-plain', systemAdmin(), { email: NEW_ADDRESS });
      state.users.set('late', person('late', NEW_ADDRESS, 'SHAREHOLDER', 'Late Signup'));

      const res = await call(
        'GET',
        `/auth/verify-email?token=${verifyTokenIn(mailsTo(NEW_ADDRESS)[0])}`,
      );

      expect(res.status).toBe(409);
      expect(state.users.get('plain')).toMatchObject({
        email: 'plain@example.test',
        pendingEmail: null,
        emailVerifyToken: null,
      });
    });

    it('drops the pending change on a unique-constraint race at confirm time', async () => {
      await editUser('adm-plain', systemAdmin(), { email: NEW_ADDRESS });
      state.users.set('late', person('late', NEW_ADDRESS, 'SHAREHOLDER', 'Late Signup'));
      // The pre-check misses the other account; the write then hits the unique index.
      prisma.user.findUnique.mockResolvedValueOnce(null);

      const res = await call(
        'GET',
        `/auth/verify-email?token=${verifyTokenIn(mailsTo(NEW_ADDRESS)[0])}`,
      );

      expect(res.status).toBe(409);
      expect(state.users.get('plain')).toMatchObject({
        email: 'plain@example.test',
        pendingEmail: null,
        emailVerifyToken: null,
      });
    });

    it('rolls the whole switch back when one write in the confirm transaction fails', async () => {
      await call('POST', '/auth/magic-link/request', {}, { email: 'plain@example.test' });
      state.refreshTokens.push({ id: 'rt-3', userId: 'plain', revokedAt: null });
      await editUser('adm-plain', systemAdmin(), { email: NEW_ADDRESS });
      const token = verifyTokenIn(mailsTo(NEW_ADDRESS)[0]);
      (prisma.refreshToken.updateMany as jest.Mock).mockImplementationOnce(() =>
        lazy(async () => {
          throw new Error('database unavailable');
        }),
      );

      expect((await call('GET', `/auth/verify-email?token=${token}`)).status).toBe(500);
      expect(state.users.get('plain')).toMatchObject({
        email: 'plain@example.test',
        pendingEmail: NEW_ADDRESS,
        emailVerifyToken: expect.any(String),
      });
      expect(state.tokens.every((t) => t.usedAt === null)).toBe(true);
      expect(state.refreshTokens[0].revokedAt).toBeNull();

      // Nothing was half-applied, so the same link works once the database is back.
      expect((await call('GET', `/auth/verify-email?token=${token}`)).status).toBe(200);
      expect(state.users.get('plain')!.email).toBe(NEW_ADDRESS);
    });

    it('lets a system admin cancel a pending change by submitting the current address', async () => {
      await editUser('adm-plain', systemAdmin(), { email: NEW_ADDRESS });
      const token = verifyTokenIn(mailsTo(NEW_ADDRESS)[0]);
      audit.log.mockClear();

      // A coop admin resending the current address does not cancel it.
      expect(
        (await editUser('adm-plain', coopAdmin(), { email: 'plain@example.test' })).status,
      ).toBe(200);
      expect(state.users.get('plain')!.pendingEmail).toBe(NEW_ADDRESS);

      const res = await editUser('adm-plain', systemAdmin(), { email: 'plain@example.test' });

      expect(res.status).toBe(200);
      expect(state.users.get('plain')).toMatchObject({
        pendingEmail: null,
        emailVerifyToken: null,
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'sysadmin',
          changes: [{ field: 'pendingEmail', oldValue: NEW_ADDRESS, newValue: null }],
        }),
      );
      expect((await call('GET', `/auth/verify-email?token=${token}`)).status).toBe(400);
      expect(state.users.get('plain')!.email).toBe('plain@example.test');
    });

    it('logs the replaced pending address when a system admin changes it again', async () => {
      await editUser('adm-plain', systemAdmin(), { email: NEW_ADDRESS });
      audit.log.mockClear();

      await editUser('adm-plain', systemAdmin(), { email: 'plain.other@example.test' });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: [
            { field: 'pendingEmail', oldValue: NEW_ADDRESS, newValue: 'plain.other@example.test' },
          ],
        }),
      );
    });

    it('treats an expired change as gone and lets resend serve the current address again', async () => {
      state.users.get('plain')!.emailVerified = null;
      await editUser('adm-plain', systemAdmin(), { email: NEW_ADDRESS });
      const oldToken = verifyTokenIn(mailsTo(NEW_ADDRESS)[0]);
      state.users.get('plain')!.emailVerifyExpires = new Date(Date.now() - 1000);
      mailer.sendPlatformEmail.mockClear();

      const me = await call('GET', '/auth/me', bearer('plain', 'COOP_ADMIN'));
      expect(me.body).toMatchObject({ email: 'plain@example.test', pendingEmail: null });

      const resend = await call('POST', '/auth/resend-verification', bearer('plain', 'COOP_ADMIN'));
      expect(resend.status).toBe(201);
      expect(state.users.get('plain')!.pendingEmail).toBeNull();
      expect(mailsTo('plain@example.test')).toHaveLength(1);
      expect(mailsTo(NEW_ADDRESS)).toHaveLength(0);
      expect((await call('GET', `/auth/verify-email?token=${oldToken}`)).status).toBe(400);
    });

    it('keeps a legacy user out of the verify wall while a change is pending', async () => {
      // Legacy: no verified date and no token, which the dashboard treats as verified.
      Object.assign(state.users.get('plain')!, { emailVerified: null, emailVerifyToken: null });
      expect((await call('GET', '/auth/me', bearer('plain', 'COOP_ADMIN'))).body).toMatchObject({
        emailVerified: true,
      });

      await editUser('adm-plain', systemAdmin(), { email: NEW_ADDRESS });

      expect((await call('GET', '/auth/me', bearer('plain', 'COOP_ADMIN'))).body).toMatchObject({
        emailVerified: true,
        pendingEmail: NEW_ADDRESS,
      });
    });

    it('still warns the old address when the verify mail fails, and keeps the change pending', async () => {
      mailer.sendPlatformEmail.mockImplementation(async (m: { to: string }) => {
        if (m.to === NEW_ADDRESS) throw new Error('smtp down');
      });

      const res = await editUser('adm-plain', systemAdmin(), { email: NEW_ADDRESS });

      expect(res.status).toBe(500);
      expect(mailsTo('plain@example.test')).toHaveLength(1);
      expect(state.users.get('plain')).toMatchObject({
        email: 'plain@example.test',
        pendingEmail: NEW_ADDRESS,
      });
    });

    it('rejects a request for an address another account already uses', async () => {
      const res = await editUser('adm-plain', systemAdmin(), { email: 'member@example.test' });
      expect(res.status).toBe(409);
      expect(state.users.get('plain')!.pendingEmail).toBeNull();
      expect(mailer.sendPlatformEmail).not.toHaveBeenCalled();
    });
  });

  describe('legitimate edits', () => {
    it('lets a coop admin edit name and language, audited, without signing anyone out', async () => {
      state.refreshTokens.push({ id: 'rt-2', userId: 'victim', revokedAt: null });

      const res = await editUser('adm-victim', coopAdmin(), {
        name: 'Renamed Member',
        preferredLanguage: 'fr',
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'Renamed Member',
        preferredLanguage: 'fr',
        email: 'member@example.test',
      });
      expect(state.refreshTokens[0].revokedAt).toBeNull();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: 'victim', actorId: 'actor' }),
      );
      expect(mailer.sendPlatformEmail).not.toHaveBeenCalled();
    });

    it('accepts the unchanged email in a different case as a no-op', async () => {
      const res = await editUser('adm-victim', coopAdmin(), {
        name: 'Renamed Member',
        email: 'Member@Example.TEST',
      });
      expect(res.status).toBe(200);
      expect(state.users.get('victim')).toMatchObject({
        email: 'member@example.test',
        pendingEmail: null,
      });
    });

    it('lets a system admin edit another system admin', async () => {
      const res = await editUser('adm-sys', systemAdmin(), { name: 'Platform Ops' });
      expect(res.status).toBe(200);
      expect(state.users.get('sysadmin')!.name).toBe('Platform Ops');
    });

    it('still demotes a regular coop admin removed from their last team', async () => {
      await call('DELETE', `/admin/coops/${COOP}/team/adm-plain`, coopAdmin());
      expect(state.users.get('plain')!.role).toBe('SHAREHOLDER');
    });

    it('keeps the member own magic-link sign-in working after a rejected attempt', async () => {
      await editUser('adm-victim', coopAdmin(), { email: ATTACKER });

      await call('POST', '/auth/magic-link/request', {}, { email: 'member@example.test' });
      expect(mailsTo('member@example.test')).toHaveLength(1);
      const res = await call(
        'POST',
        '/auth/magic-link/code',
        {},
        { email: 'member@example.test', code: CODE },
      );
      expect(res.status).toBe(201);
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

  it('rejects a malformed email, an unknown language and an oversized name', async () => {
    await expect(errorsFor({ email: { $ne: '' } })).resolves.toEqual(['email']);
    await expect(errorsFor({ email: 'not-an-address' })).resolves.toEqual(['email']);
    await expect(errorsFor({ preferredLanguage: 'xx' })).resolves.toEqual(['preferredLanguage']);
    await expect(errorsFor({ name: 'x'.repeat(101) })).resolves.toEqual(['name']);
  });
});
