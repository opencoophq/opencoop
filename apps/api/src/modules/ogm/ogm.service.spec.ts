import { NotFoundException } from '@nestjs/common';
import { generateOgmCode } from '@opencoop/shared';
import { OgmService } from './ogm.service';
import { MAX_OGM_SEQUENCE } from './ogm';

describe('OgmService.nextOgmCode', () => {
  const service = new OgmService({} as any);

  it('returns the OGM for the incremented sequence with the coop prefix', async () => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([{ ogmPrefix: '001', ogmSequence: 42 }]) };

    await expect(service.nextOgmCode(db as any, 'coop-1')).resolves.toBe(generateOgmCode('001', 42));
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException for an unknown coop', async () => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([]) };

    await expect(service.nextOgmCode(db as any, 'missing')).rejects.toThrow(NotFoundException);
  });

  it('refuses a sequence that no longer fits in 7 digits', async () => {
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ ogmPrefix: '001', ogmSequence: MAX_OGM_SEQUENCE + 1 }]),
    };

    await expect(service.nextOgmCode(db as any, 'coop-1')).rejects.toThrow(/exhausted/);
  });
});
