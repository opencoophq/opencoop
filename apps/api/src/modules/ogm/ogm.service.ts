import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { generateOgmCode } from '@opencoop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MAX_OGM_SEQUENCE } from './ogm';

@Injectable()
export class OgmService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Hands out the next OGM of a coop. One atomic UPDATE ... RETURNING on the
   * coop row, so concurrent callers never get the same sequence. Registrations
   * and charge cards share this counter, so their codes never collide.
   */
  async nextOgmCode(db: Prisma.TransactionClient, coopId: string): Promise<string> {
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
    return generateOgmCode(ogmPrefix, ogmSequence);
  }
}
