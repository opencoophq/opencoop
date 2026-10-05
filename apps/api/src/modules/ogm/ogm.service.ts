import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { generateOgmCode } from '@opencoop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MAX_OGM_SEQUENCE } from './ogm';

/** Give up on skip-taken retries after this many attempts, rather than loop forever. */
const MAX_SKIP_ATTEMPTS = 1000;

@Injectable()
export class OgmService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Hands out the next OGM of a coop. One atomic UPDATE ... RETURNING on the
   * coop row, so concurrent callers never get the same sequence. Registrations
   * and charge cards share this counter, so their codes never collide.
   *
   * A code can still pre-exist for a sequence this counter is about to hand
   * out: an out-of-band writer (a deploy-window old API still doing
   * count+1, a manual insert, a migration re-run) can plant a code the
   * counter has not reached yet. Without a check, the caller's INSERT then
   * fails on the unique constraint, the transaction rolls back the
   * increment, and every later call re-issues the same taken code forever —
   * a silent, permanent lock on that coop's purchases. So we skip forward,
   * under the same row lock, until the generated code is actually free.
   */
  async nextOgmCode(db: Prisma.TransactionClient, coopId: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_SKIP_ATTEMPTS; attempt++) {
      const rows = await db.$queryRaw<{ ogmPrefix: string; ogmSequence: number }[]>`
        UPDATE "coops" SET "ogmSequence" = "ogmSequence" + 1
        WHERE "id" = ${coopId}
        RETURNING "ogmPrefix", "ogmSequence"`;
      if (rows.length === 0) {
        throw new NotFoundException('Cooperative not found');
      }
      const { ogmPrefix, ogmSequence } = rows[0];
      if (ogmSequence > MAX_OGM_SEQUENCE) {
        throw new Error(`OGM sequence exhausted for coop ${coopId}`);
      }
      const code = generateOgmCode(ogmPrefix, ogmSequence);
      if (!(await this.isOgmCodeTaken(db, code))) {
        return code;
      }
    }
    throw new Error(`Could not find a free OGM code for coop ${coopId} after ${MAX_SKIP_ATTEMPTS} attempts`);
  }

  /** True if some row already holds this OGM code. */
  private async isOgmCodeTaken(db: Prisma.TransactionClient, code: string): Promise<boolean> {
    if ((await db.registration.findFirst({ where: { ogmCode: code }, select: { id: true } })) !== null) {
      return true;
    }
    return (await db.chargeCard.findFirst({ where: { ogmCode: code }, select: { id: true } })) !== null;
  }
}
