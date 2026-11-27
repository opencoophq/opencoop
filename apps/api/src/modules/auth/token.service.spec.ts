import { UnauthorizedException } from '@nestjs/common';
import { hashToken } from '../../common/crypto/hash-token';
import { SESSION_MAX_LIFETIME_MS, SESSION_ROTATION_INTERVAL_MS } from './session-lifetime';
import { TokenService } from './token.service';

type Row = {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
};

function harness() {
  const rows: Row[] = [];
  let seq = 0;
  const user = {
    id: 'user-1',
    email: 'ada@example.com',
    name: 'Ada',
    role: 'USER',
    preferredLanguage: 'nl',
    emailVerified: new Date('2026-01-01T00:00:00.000Z'),
    sessionVersion: 0,
    coopAdminOf: [],
  };
  const prisma = {
    user: {
      async findUnique(args: { where: { id: string } }) {
        return args.where.id === user.id ? { sessionVersion: user.sessionVersion } : null;
      },
      async update(args: { where: { id: string }; data: { sessionVersion: { increment: number } } }) {
        user.sessionVersion += args.data.sessionVersion.increment;
        return user;
      },
    },
    refreshToken: {
      async findUnique(args: { where: { tokenHash?: string; id?: string }; include?: unknown }) {
        const row = rows.find((candidate) =>
          args.where.tokenHash ? candidate.tokenHash === args.where.tokenHash : candidate.id === args.where.id,
        );
        if (!row) return null;
        return args.include ? { ...row, user } : { ...row };
      },
      async create(args: { data: Omit<Row, 'id' | 'revokedAt'> }) {
        const row: Row = { id: `sess-${++seq}`, revokedAt: null, ...args.data };
        rows.push(row);
        return row;
      },
      async updateMany(args: {
        where: { id?: string; userId?: string; revokedAt?: Date | null };
        data: { revokedAt: Date };
      }) {
        const matches = rows.filter((row) => {
          if (args.where.id && row.id !== args.where.id) return false;
          if (args.where.userId && row.userId !== args.where.userId) return false;
          if (args.where.revokedAt === null && row.revokedAt !== null) return false;
          return true;
        });
        for (const row of matches) row.revokedAt = args.data.revokedAt;
        return { count: matches.length };
      },
    },
    /** lockSessionVersion's SELECT ... FOR SHARE; the only value is the user id. */
    async $queryRaw(_sql: TemplateStringsArray, userId: string) {
      return userId === user.id ? [{ sessionVersion: user.sessionVersion }] : [];
    },
    $transaction(fn: (tx: typeof prisma) => Promise<unknown>) {
      return fn(prisma);
    },
  };
  const jwt = {
    sign: jest.fn((payload: { sid?: string; sst?: number; sv?: number; type?: string }) =>
      JSON.stringify(payload),
    ),
  };
  return { service: new TokenService(prisma as never, jwt as never), rows, user, jwt };
}

const issuedAt = new Date('2026-01-01T00:00:00.000Z');

describe('TokenService session rotation', () => {
  it('issues a session whose hard maximum is 30 days and that is not rotated while it is young', async () => {
    const { service, rows } = harness();
    const { user } = harness();
    const issued = await service.issueJwtForUser(user, false, issuedAt);
    if (!('refreshToken' in issued)) throw new Error('expected a session');
    expect(rows).toHaveLength(1);
    expect(rows[0].expiresAt.toISOString()).toBe(new Date(issuedAt.getTime() + SESSION_MAX_LIFETIME_MS).toISOString());
    expect(rows[0].revokedAt).toBeNull();

    const refreshed = await service.refreshAccessToken(issued.refreshToken!, {
      rotate: true,
      now: new Date(issuedAt.getTime() + SESSION_ROTATION_INTERVAL_MS - 1),
    });
    expect(refreshed.refreshToken).toBeUndefined();
    expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });

  it('reissues a session token at 24 hours, revokes the old one, and keeps the original expiry', async () => {
    const { service, rows, user } = harness();
    const issued = await service.issueJwtForUser(user, false, issuedAt);
    const oldRaw = issued.refreshToken!;
    const now = new Date(issuedAt.getTime() + SESSION_ROTATION_INTERVAL_MS);

    const refreshed = await service.refreshAccessToken(oldRaw, { rotate: true, now });

    expect(refreshed.refreshToken).toBeDefined();
    expect(refreshed.refreshToken).not.toBe(oldRaw);
    expect(rows).toHaveLength(2);
    expect(rows[0].revokedAt?.toISOString()).toBe(now.toISOString());
    expect(rows[1].expiresAt.toISOString()).toBe(rows[0].expiresAt.toISOString());
    expect(rows[1].expiresAt.getTime() - now.getTime()).toBeLessThan(SESSION_MAX_LIFETIME_MS);
    expect(JSON.parse(refreshed.accessToken).sid).toBe(rows[1].id);

    await expect(service.refreshAccessToken(oldRaw, { rotate: true, now })).rejects.toBeInstanceOf(UnauthorizedException);
    const again = await service.refreshAccessToken(refreshed.refreshToken!, {
      rotate: true,
      now: new Date(now.getTime() + 60_000),
    });
    expect(again.refreshToken).toBeUndefined();
  });

  it('does not rotate or revoke when the client has not opted in', async () => {
    const { service, rows, user } = harness();
    const issued = await service.issueJwtForUser(user, false, issuedAt);
    const now = new Date(issuedAt.getTime() + 10 * SESSION_ROTATION_INTERVAL_MS);

    const refreshed = await service.refreshAccessToken(issued.refreshToken!, { now });

    expect(refreshed.refreshToken).toBeUndefined();
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).toBeNull();
    await expect(service.refreshAccessToken(issued.refreshToken!, { now })).resolves.toEqual(
      expect.objectContaining({ accessToken: expect.any(String) }),
    );
  });

  it('rejects an expired session instead of extending it', async () => {
    const { service, rows, user } = harness();
    const issued = await service.issueJwtForUser(user, false, issuedAt);
    const afterMax = new Date(issuedAt.getTime() + SESSION_MAX_LIFETIME_MS);

    await expect(
      service.refreshAccessToken(issued.refreshToken!, { rotate: true, now: afterMax }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).toBeNull();
  });

  it('rotates on an authenticated request once the stored session is 24 hours old', async () => {
    const { service, rows, user } = harness();
    await service.issueJwtForUser(user, false, issuedAt);
    const tooSoon = new Date(issuedAt.getTime() + SESSION_ROTATION_INTERVAL_MS - 1);
    expect(await service.rotateIfDue(rows[0].id, tooSoon)).toBeNull();
    expect(rows[0].revokedAt).toBeNull();

    const now = new Date(issuedAt.getTime() + SESSION_ROTATION_INTERVAL_MS);
    const next = await service.rotateIfDue(rows[0].id, now);
    expect(next).toEqual(expect.any(String));
    expect(rows[0].revokedAt).not.toBeNull();
    expect(rows[1].tokenHash).toBe(hashToken(next!));
    expect(rows[1].expiresAt.toISOString()).toBe(rows[0].expiresAt.toISOString());
    expect(await service.rotateIfDue(rows[0].id, now)).toBeNull();
  });

  it('invalidates every session on revoke', async () => {
    const { service, rows, user } = harness();
    const first = await service.issueJwtForUser(user, false, issuedAt);
    const second = await service.issueJwtForUser(user, false, issuedAt);
    await service.revokeAllSessions(user.id);

    expect(rows.every((row) => row.revokedAt instanceof Date)).toBe(true);
    expect(user.sessionVersion).toBe(1);
    await expect(service.refreshAccessToken(first.refreshToken!)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refreshAccessToken(second.refreshToken!)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('TokenService session version', () => {
  it('signs the stored session version as the sv claim', async () => {
    const { service, user } = harness();
    const before = await service.issueJwtForUser(user, false, issuedAt);
    expect(JSON.parse(before.accessToken!).sv).toBe(0);

    await service.revokeAllSessions(user.id);
    const after = await service.issueJwtForUser({ ...user, sessionVersion: undefined } as never, false, issuedAt);
    // Read from the row, not the caller's object.
    expect(JSON.parse(after.accessToken!).sv).toBe(1);

    const refreshed = await service.refreshAccessToken(after.refreshToken!, { now: issuedAt });
    expect(JSON.parse(refreshed.accessToken).sv).toBe(1);
  });

  it('refuses to issue a session for a user that no longer exists', async () => {
    const { service, user } = harness();
    await expect(
      service.issueJwtForUser({ ...user, id: 'gone' }, false, issuedAt),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
