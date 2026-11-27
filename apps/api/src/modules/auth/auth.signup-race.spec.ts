jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from './auth.service';

function uniqueViolation(target: string[] | string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

/**
 * A fake Prisma client that enforces the unique columns like Postgres does.
 * Both concurrent requests pass the `findUnique` pre-check before either
 * insert lands, which is the race seen on acc.
 */
function buildRacingService(racers = 2) {
  const users = new Map<string, { id: string; email: string }>();
  const coopSlugs = new Set<string>();
  let n = 0;

  // Hold every pre-check until all racing requests have made one, so all see "free".
  let waiting: Array<() => void> = [];
  const barrier = () =>
    new Promise<null>((resolve) => {
      waiting.push(() => resolve(null));
      if (waiting.length === racers) {
        waiting.forEach((release) => release());
        waiting = [];
      }
    });

  const createUser = jest.fn(async ({ data }: { data: { email: string } }) => {
    await Promise.resolve();
    if (users.has(data.email)) throw uniqueViolation(['email']);
    const user = {
      id: `user-${++n}`,
      email: data.email,
      name: 'Ada',
      role: 'COOP_ADMIN',
      preferredLanguage: 'nl',
    };
    users.set(data.email, user);
    return user;
  });

  const tx = {
    user: { create: createUser },
    coop: {
      create: jest.fn(async ({ data }: { data: { slug: string; name: string } }) => {
        if (coopSlugs.has(data.slug)) throw uniqueViolation('coops_slug_key');
        coopSlugs.add(data.slug);
        return { id: `coop-${data.slug}`, slug: data.slug, name: data.name, plan: 'FREE' };
      }),
    },
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

  // A transaction rolls back: undo the user row when a later step throws.
  const $transaction = jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => {
    const before = new Set(users.keys());
    try {
      return await fn(tx);
    } catch (err) {
      for (const email of users.keys()) if (!before.has(email)) users.delete(email);
      throw err;
    }
  });

  const prisma = {
    user: { findUnique: jest.fn(barrier), create: createUser },
    coop: { findUnique: jest.fn(barrier) },
    $transaction,
  };

  const service = new AuthService(
    prisma as never,
    {} as never,
    {} as never,
    { notifyCoopCreated: jest.fn() } as never,
    { sendVerificationEmail: jest.fn().mockResolvedValue(undefined) } as never,
    { generateUniqueOgmPrefix: jest.fn().mockResolvedValue('004') } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    { issueJwtForUser: jest.fn().mockResolvedValue({ accessToken: 'a' }) } as never,
  );
  // Linking orphan shareholders is fire-and-forget and out of scope here.
  jest.spyOn(service as never, 'linkOrphanShareholders').mockResolvedValue(undefined as never);

  return { service, prisma, users, coopSlugs, tx };
}

/** The 409 the ordinary duplicate check throws (pinned by the second test). */
async function normalDuplicateResponse(message: string) {
  const err = new ConflictException(message);
  return { status: err.getStatus(), body: err.getResponse() };
}

async function asResponse(p: Promise<unknown>) {
  const err = await p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ConflictException);
  const conflict = err as ConflictException;
  return { status: conflict.getStatus(), body: conflict.getResponse() };
}

describe('AuthService — concurrent signups with the same email', () => {
  const registerDto = { email: 'Race@Example.test', password: 'Secret123', name: 'Ada' };

  it('register: one request wins, the other gets the normal 409, one user exists', async () => {
    const { service, users } = buildRacingService();

    const results = await Promise.allSettled([
      service.register(registerDto as never),
      service.register(registerDto as never),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(await asResponse(Promise.reject(rejected.reason))).toEqual(
      await normalDuplicateResponse('Email already registered'),
    );
    expect(users.size).toBe(1);
  });

  it('register: the race body equals the body of the ordinary duplicate check', async () => {
    const { service, prisma } = buildRacingService();
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'existing' } as never);

    const ordinary = await asResponse(service.register(registerDto as never));

    expect(ordinary).toEqual({
      status: 409,
      body: { statusCode: 409, message: 'Email already registered', error: 'Conflict' },
    });
  });

  const onboardDto = (slug: string, email: string) => ({
    email,
    password: 'Secret123',
    coopName: 'Race Coop',
    coopSlug: slug,
    plan: 'free' as const,
    name: 'Ada',
    preferredLanguage: 'nl',
    termsAccepted: true,
  });

  it('onboard: same email in parallel returns the normal email 409 and one user', async () => {
    const { service, users, coopSlugs } = buildRacingService();

    const results = await Promise.allSettled([
      service.onboard(onboardDto('coop-a', 'race@example.test')),
      service.onboard(onboardDto('coop-b', 'race@example.test')),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(await asResponse(Promise.reject(rejected.reason))).toEqual(
      await normalDuplicateResponse('Email already registered'),
    );
    expect(users.size).toBe(1);
    expect(coopSlugs.size).toBe(1);
  });

  it('onboard: same slug in parallel returns the normal slug 409 and one coop', async () => {
    const { service, users, coopSlugs } = buildRacingService();

    const results = await Promise.allSettled([
      service.onboard(onboardDto('same-slug', 'a@example.test')),
      service.onboard(onboardDto('same-slug', 'b@example.test')),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(await asResponse(Promise.reject(rejected.reason))).toEqual(
      await normalDuplicateResponse('Slug already in use'),
    );
    expect(coopSlugs.size).toBe(1);
    // The loser's user row rolled back with its transaction.
    expect(users.size).toBe(1);
  });

  it('onboard: a unique violation on another column is not mapped to 409', async () => {
    const { service, tx } = buildRacingService(1);
    const ogmClash = uniqueViolation(['ogmPrefix']);
    tx.coop.create.mockRejectedValueOnce(ogmClash);

    await expect(service.onboard(onboardDto('other', 'c@example.test'))).rejects.toBe(ogmClash);
  });
});
