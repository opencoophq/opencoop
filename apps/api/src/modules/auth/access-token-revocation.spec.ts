jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

jest.mock('bcrypt', () => ({
  compare: jest.fn(async () => true),
  hash: jest.fn(async () => 'hashed-new-password'),
}));

import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { hashToken } from '../../common/crypto/hash-token';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CoopAdminsService } from '../coop-admins/coop-admins.service';
import { ShareholderMeetingsController } from '../meetings/shareholder-meetings.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmancipationService } from './emancipation.service';
import { MagicLinkService } from './magic-link.service';
import { MfaService } from './mfa.service';
import { OAuthService } from './oauth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';
import { WebAuthnService } from './webauthn.service';

const JWT_SECRET = 'test-only-secret';

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  preferredLanguage: string;
  emailVerified: Date | null;
  mfaEnabled: boolean;
  passwordHash: string | null;
  passwordResetToken: string | null;
  passwordResetExpires: Date | null;
  sessionVersion: number;
};

type RefreshRow = {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
};

/** In-memory stand-in for the Prisma calls the auth path makes. */
function fakePrisma() {
  const users = new Map<string, UserRow>();
  const refreshRows: RefreshRow[] = [];
  let seq = 0;

  const withRelations = (user: UserRow) => ({ ...user, coopAdminOf: [] });

  const prisma = {
    users,
    refreshRows,
    user: {
      async findUnique(args: { where: { id: string }; select?: Record<string, boolean> }) {
        const user = users.get(args.where.id);
        if (!user) return null;
        if (args.select) {
          return Object.fromEntries(Object.keys(args.select).map((k) => [k, user[k as keyof UserRow]]));
        }
        return withRelations(user);
      },
      async findFirst(args: { where: { passwordResetToken: string; passwordResetExpires: { gt: Date } } }) {
        for (const user of users.values()) {
          if (
            user.passwordResetToken === args.where.passwordResetToken &&
            user.passwordResetExpires &&
            user.passwordResetExpires > args.where.passwordResetExpires.gt
          ) {
            return { ...user };
          }
        }
        return null;
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        const user = users.get(args.where.id);
        if (!user) throw new Error('P2025: record not found');
        for (const [key, value] of Object.entries(args.data)) {
          if (value && typeof value === 'object' && 'increment' in value) {
            (user as Record<string, unknown>)[key] =
              (user[key as keyof UserRow] as number) + (value as { increment: number }).increment;
          } else {
            (user as Record<string, unknown>)[key] = value;
          }
        }
        return { ...user };
      },
      /** Deleting a user cascades to its refresh tokens, as the FK does. */
      async delete(args: { where: { id: string } }) {
        users.delete(args.where.id);
        for (let i = refreshRows.length - 1; i >= 0; i--) {
          if (refreshRows[i].userId === args.where.id) refreshRows.splice(i, 1);
        }
      },
    },
    refreshToken: {
      async findUnique(args: { where: { tokenHash?: string; id?: string }; include?: unknown }) {
        const row = refreshRows.find((r) =>
          args.where.tokenHash ? r.tokenHash === args.where.tokenHash : r.id === args.where.id,
        );
        if (!row) return null;
        const user = users.get(row.userId);
        return args.include && user ? { ...row, user: withRelations(user) } : { ...row };
      },
      async create(args: { data: Omit<RefreshRow, 'id' | 'revokedAt'> }) {
        const row: RefreshRow = { id: `sess-${++seq}`, revokedAt: null, ...args.data };
        refreshRows.push(row);
        return row;
      },
      async updateMany(args: {
        where: { id?: string; userId?: string; revokedAt?: null };
        data: { revokedAt: Date };
      }) {
        const matches = refreshRows.filter(
          (r) =>
            (!args.where.id || r.id === args.where.id) &&
            (!args.where.userId || r.userId === args.where.userId) &&
            (args.where.revokedAt !== null || r.revokedAt === null),
        );
        for (const r of matches) r.revokedAt = args.data.revokedAt;
        return { count: matches.length };
      },
    },
    shareholder: { findMany: async () => [] },
    meeting: { findMany: async () => [] },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(prisma);
    },
  };
  return prisma;
}

describe('access tokens are revocable', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: ReturnType<typeof fakePrisma>;
  let tokens: TokenService;
  let jwt: JwtService;

  beforeAll(async () => {
    prisma = fakePrisma();
    const auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET })] }),
        PassportModule,
        JwtModule.register({ secret: JWT_SECRET }),
      ],
      controllers: [AuthController, ShareholderMeetingsController],
      providers: [
        JwtStrategy,
        TokenService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: AuthService,
          inject: [TokenService],
          useFactory: (tokenService: TokenService) => {
            const service = new AuthService(
              prisma as never,
              {} as never,
              {} as never,
              {} as never,
              {} as never,
              {} as never,
              auditService as never,
              tokenService,
            );
            // /auth/me's heavy profile query is not under test; the guard is.
            jest.spyOn(service, 'getProfile').mockImplementation(async (id: string) => ({ id }) as never);
            return service;
          },
        },
        { provide: MfaService, useValue: {} },
        { provide: OAuthService, useValue: {} },
        { provide: MagicLinkService, useValue: {} },
        { provide: EmancipationService, useValue: {} },
        { provide: WebAuthnService, useValue: {} },
        { provide: CoopAdminsService, useValue: {} },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    tokens = moduleRef.get(TokenService);
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  let userSeq = 0;
  async function login() {
    const id = `user-${++userSeq}`;
    prisma.users.set(id, {
      id,
      email: `${id}@example.com`,
      name: null,
      role: 'SHAREHOLDER',
      preferredLanguage: 'nl',
      emailVerified: new Date(),
      mfaEnabled: false,
      passwordHash: 'stored',
      passwordResetToken: null,
      passwordResetExpires: null,
      sessionVersion: 0,
    });
    const session = await tokens.issueJwtForUser(prisma.users.get(id)!);
    return { id, accessToken: session.accessToken!, refreshToken: session.refreshToken! };
  }

  function get(path: string, accessToken: string) {
    return fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  }

  function post(path: string, body: Record<string, string>, accessToken?: string) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it('accepts a valid access token on /auth/me and /meetings/upcoming', async () => {
    const { accessToken } = await login();
    expect((await get('/auth/me', accessToken)).status).toBe(200);
    expect((await get('/meetings/upcoming', accessToken)).status).toBe(200);
  });

  it('accepts a refreshed access token', async () => {
    const { refreshToken } = await login();
    const res = await post('/auth/refresh', { refreshToken });
    expect(res.status).toBe(201);
    const { accessToken } = (await res.json()) as { accessToken: string };
    expect((await get('/auth/me', accessToken)).status).toBe(200);
  });

  it('rejects the old access token and the refresh token after logout', async () => {
    const { accessToken, refreshToken } = await login();
    expect((await post('/auth/logout', {}, accessToken)).status).toBe(201);

    expect((await get('/auth/me', accessToken)).status).toBe(401);
    expect((await get('/meetings/upcoming', accessToken)).status).toBe(401);
    expect((await post('/auth/refresh', { refreshToken })).status).toBe(401);
  });

  it('ends every session of the user on logout, not only the caller', async () => {
    const first = await login();
    const second = await tokens.issueJwtForUser(prisma.users.get(first.id)!);
    await post('/auth/logout', {}, first.accessToken);

    expect((await get('/auth/me', second.accessToken!)).status).toBe(401);
    expect((await post('/auth/refresh', { refreshToken: second.refreshToken! })).status).toBe(401);
  });

  it('rejects the token on a protected endpoint after the user is deleted', async () => {
    const { id, accessToken, refreshToken } = await login();
    await prisma.user.delete({ where: { id } });

    expect((await get('/meetings/upcoming', accessToken)).status).toBe(401);
    expect((await get('/auth/me', accessToken)).status).toBe(401);
    expect((await post('/auth/refresh', { refreshToken })).status).toBe(401);
  });

  it('rejects old access and refresh tokens after a password reset; a new login works', async () => {
    const { id, accessToken, refreshToken } = await login();
    const user = prisma.users.get(id)!;
    user.passwordResetToken = hashToken('reset-token');
    user.passwordResetExpires = new Date(Date.now() + 60_000);

    const reset = await post('/auth/reset-password', { token: 'reset-token', password: 'new-password-1' });
    expect(reset.status).toBe(201);

    expect((await get('/auth/me', accessToken)).status).toBe(401);
    expect((await get('/meetings/upcoming', accessToken)).status).toBe(401);
    expect((await post('/auth/refresh', { refreshToken })).status).toBe(401);

    const fresh = await tokens.issueJwtForUser(prisma.users.get(id)!);
    expect((await get('/auth/me', fresh.accessToken!)).status).toBe(200);
  });

  it('rejects old tokens after change-password and returns a working session for the caller', async () => {
    const { accessToken, refreshToken } = await login();
    const res = await post(
      '/auth/change-password',
      { currentPassword: 'old-password', newPassword: 'new-password-1' },
      accessToken,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { accessToken: string; refreshToken: string };

    expect((await get('/auth/me', accessToken)).status).toBe(401);
    expect((await post('/auth/refresh', { refreshToken })).status).toBe(401);
    expect((await get('/auth/me', body.accessToken)).status).toBe(200);
    expect((await post('/auth/refresh', { refreshToken: body.refreshToken })).status).toBe(201);
  });

  it('accepts a legacy token without sv or sid until the first revocation', async () => {
    const { id } = await login();
    const legacy = jwt.sign({ sub: id, email: `${id}@example.com`, role: 'SHAREHOLDER' }, { expiresIn: '15m' });
    expect((await get('/auth/me', legacy)).status).toBe(200);

    await tokens.revokeAllSessions(id);
    expect((await get('/auth/me', legacy)).status).toBe(401);
  });

  it('still rejects an MFA-pending token on normal routes', async () => {
    const { id } = await login();
    const pending = jwt.sign({ sub: id, type: 'mfa-pending' }, { expiresIn: '5m' });
    expect((await get('/auth/me', pending)).status).toBe(401);
  });
});
