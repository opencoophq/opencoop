import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { generateOgmCode } from '@opencoop/shared';
import { OgmService } from './ogm.service';
import { MAX_OGM_SEQUENCE } from './ogm';

describe('OgmService.nextOgmCode', () => {
  const service = new OgmService({} as any);

  it('returns the OGM for the incremented sequence with the coop prefix', async () => {
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ ogmPrefix: '001', ogmSequence: 42 }]),
      registration: { findFirst: jest.fn().mockResolvedValue(null) },
      chargeCard: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    await expect(service.nextOgmCode(db as any, 'coop-1')).resolves.toBe(generateOgmCode('001', 42));
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException for an unknown coop', async () => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([]), registration: { findFirst: jest.fn() } };

    await expect(service.nextOgmCode(db as any, 'missing')).rejects.toThrow(NotFoundException);
  });

  it('refuses a sequence that no longer fits in 7 digits', async () => {
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ ogmPrefix: '001', ogmSequence: MAX_OGM_SEQUENCE + 1 }]),
      registration: { findFirst: jest.fn() },
    };

    await expect(service.nextOgmCode(db as any, 'coop-1')).rejects.toThrow(/exhausted/);
  });

  it('skips a sequence already held by a registration and returns the following free code', async () => {
    const db = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ ogmPrefix: '001', ogmSequence: 42 }])
        .mockResolvedValueOnce([{ ogmPrefix: '001', ogmSequence: 43 }]),
      registration: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'r1' }) // code for seq 42 is already taken
          .mockResolvedValueOnce(null), // code for seq 43 is free
      },
      chargeCard: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    await expect(service.nextOgmCode(db as any, 'coop-1')).resolves.toBe(generateOgmCode('001', 43));
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(db.registration.findFirst).toHaveBeenCalledTimes(2);
    expect(db.registration.findFirst).toHaveBeenNthCalledWith(1, {
      where: { ogmCode: generateOgmCode('001', 42) },
      select: { id: true },
    });
  });

  it('skips a sequence already held by a charge card and returns the following free code', async () => {
    const db = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ ogmPrefix: '001', ogmSequence: 42 }])
        .mockResolvedValueOnce([{ ogmPrefix: '001', ogmSequence: 43 }]),
      registration: { findFirst: jest.fn().mockResolvedValue(null) },
      chargeCard: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'c1' }) // code for seq 42 is already taken by a charge card
          .mockResolvedValueOnce(null), // code for seq 43 is free
      },
    };

    await expect(service.nextOgmCode(db as any, 'coop-1')).resolves.toBe(generateOgmCode('001', 43));
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(db.chargeCard.findFirst).toHaveBeenCalledTimes(2);
    expect(db.chargeCard.findFirst).toHaveBeenNthCalledWith(1, {
      where: { ogmCode: generateOgmCode('001', 42) },
      select: { id: true },
    });
  });

  it('gives up after MAX_SKIP_ATTEMPTS consecutive collisions', async () => {
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ ogmPrefix: '001', ogmSequence: 1 }]),
      registration: { findFirst: jest.fn().mockResolvedValue({ id: 'always-taken' }) },
      chargeCard: { findFirst: jest.fn() },
    };

    await expect(service.nextOgmCode(db as any, 'coop-1')).rejects.toThrow(/Could not find a free OGM code/);
  });
});

describe('OgmService resolvers', () => {
  const OGM = '+++090/9337/55493+++';
  const registrationRow = {
    id: 'reg-1',
    coopId: 'coop-1',
    status: 'PENDING_PAYMENT',
    totalAmount: new Prisma.Decimal('250.00'),
    ogmCode: OGM,
    payments: [],
  };
  let prisma: any;
  let service: OgmService;

  beforeEach(() => {
    prisma = {
      registration: {
        findMany: jest.fn().mockResolvedValue([registrationRow]),
        findFirst: jest.fn().mockResolvedValue(registrationRow),
      },
      chargeCard: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    service = new OgmService(prisma);
  });

  it('normalises digit-only and formatted OGMs into one coop-scoped query', async () => {
    const targets = await service.resolveOgmTargets('coop-1', ['090933755493', OGM, 'not an ogm', null]);

    expect(prisma.registration.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.registration.findMany.mock.calls[0][0].where).toEqual({
      coopId: 'coop-1',
      ogmCode: { in: [OGM] },
    });
    expect(targets.get(OGM)).toEqual({ kind: 'registration', ...registrationRow });
  });

  it('does not query when no input is a valid OGM', async () => {
    const targets = await service.resolveOgmTargets('coop-1', ['hello', null, undefined]);

    expect(targets.size).toBe(0);
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
  });

  it('resolveOgmTarget normalises the OGM and looks it up within the coop', async () => {
    await expect(service.resolveOgmTarget('coop-1', '090933755493')).resolves.toMatchObject({
      kind: 'registration',
      id: 'reg-1',
    });

    expect(prisma.registration.findFirst.mock.calls[0][0].where).toEqual({ coopId: 'coop-1', ogmCode: OGM });
  });

  it('resolveOgmTarget returns null for an invalid OGM without querying', async () => {
    await expect(service.resolveOgmTarget('coop-1', '123')).resolves.toBeNull();
    expect(prisma.registration.findFirst).not.toHaveBeenCalled();
  });

  it('resolveOgmTarget returns null when no registration has the OGM', async () => {
    prisma.registration.findFirst.mockResolvedValue(null);

    await expect(service.resolveOgmTarget('coop-1', OGM)).resolves.toBeNull();
  });

  const CARD_OGM = '+++001/0000/04221+++';
  const cardRow = {
    id: 'card-1',
    coopId: 'coop-1',
    shareholderId: 'sh-1',
    status: 'REQUESTED',
    feeInclVat: new Prisma.Decimal('6.00'),
    ogmCode: CARD_OGM,
  };
  const cardTarget = { ...cardRow, kind: 'chargeCard', feeInclVat: 6 };

  it('resolves a charge-card OGM in the same batch, scoped to the coop', async () => {
    prisma.registration.findMany.mockResolvedValue([]);
    prisma.chargeCard.findMany.mockResolvedValue([cardRow]);

    const targets = await service.resolveOgmTargets('coop-1', ['001000004221']);

    expect(prisma.chargeCard.findMany.mock.calls[0][0].where).toEqual({
      coopId: 'coop-1',
      ogmCode: { in: [CARD_OGM] },
    });
    expect(targets.get(CARD_OGM)).toEqual(cardTarget);
  });

  it('resolveOgmTarget falls back to a charge card when no registration has the OGM', async () => {
    prisma.registration.findFirst.mockResolvedValue(null);
    prisma.chargeCard.findFirst.mockResolvedValue(cardRow);

    await expect(service.resolveOgmTarget('coop-1', CARD_OGM)).resolves.toEqual(cardTarget);
    expect(prisma.chargeCard.findFirst.mock.calls[0][0].where).toEqual({ coopId: 'coop-1', ogmCode: CARD_OGM });
  });

  it('findChargeCardTarget looks a card up by id within the coop', async () => {
    prisma.chargeCard.findFirst.mockResolvedValue(cardRow);

    await expect(service.findChargeCardTarget('coop-1', 'card-1')).resolves.toEqual(cardTarget);
    expect(prisma.chargeCard.findFirst.mock.calls[0][0].where).toEqual({ id: 'card-1', coopId: 'coop-1' });
  });
});
