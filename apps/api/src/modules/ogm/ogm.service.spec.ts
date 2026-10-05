import { NotFoundException } from '@nestjs/common';
import { generateOgmCode } from '@opencoop/shared';
import { OgmService } from './ogm.service';
import { MAX_OGM_SEQUENCE } from './ogm';

describe('OgmService.nextOgmCode', () => {
  const service = new OgmService({} as any);

  it('returns the OGM for the incremented sequence with the coop prefix', async () => {
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ ogmPrefix: '001', ogmSequence: 42 }]),
      registration: { findFirst: jest.fn().mockResolvedValue(null) },
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
    };

    await expect(service.nextOgmCode(db as any, 'coop-1')).resolves.toBe(generateOgmCode('001', 43));
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(db.registration.findFirst).toHaveBeenCalledTimes(2);
    expect(db.registration.findFirst).toHaveBeenNthCalledWith(1, {
      where: { ogmCode: generateOgmCode('001', 42) },
      select: { id: true },
    });
  });

  it('gives up after MAX_SKIP_ATTEMPTS consecutive collisions', async () => {
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ ogmPrefix: '001', ogmSequence: 1 }]),
      registration: { findFirst: jest.fn().mockResolvedValue({ id: 'always-taken' }) },
    };

    await expect(service.nextOgmCode(db as any, 'coop-1')).rejects.toThrow(/Could not find a free OGM code/);
  });
});
