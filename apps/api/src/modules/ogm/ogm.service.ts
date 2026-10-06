import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { extractOgmCode, generateOgmCode } from '@opencoop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MAX_OGM_SEQUENCE } from './ogm';
import { ChargeCardTarget, PaymentTarget, RegistrationTarget } from './payment-target';

/** Give up on skip-taken retries after this many attempts, rather than loop forever. */
const MAX_SKIP_ATTEMPTS = 1000;

const REGISTRATION_TARGET_SELECT = {
  id: true,
  coopId: true,
  status: true,
  totalAmount: true,
  ogmCode: true,
  payments: { select: { id: true, amount: true, bankDate: true, bankTransactionId: true } },
} satisfies Prisma.RegistrationSelect;

type RegistrationTargetRow = Prisma.RegistrationGetPayload<{ select: typeof REGISTRATION_TARGET_SELECT }>;

function toRegistrationTarget(row: RegistrationTargetRow): RegistrationTarget {
  return { kind: 'registration', ...row };
}

const CHARGE_CARD_TARGET_SELECT = {
  id: true,
  coopId: true,
  shareholderId: true,
  status: true,
  feeInclVat: true,
  ogmCode: true,
} satisfies Prisma.ChargeCardSelect;

type ChargeCardTargetRow = Prisma.ChargeCardGetPayload<{ select: typeof CHARGE_CARD_TARGET_SELECT }>;

function toChargeCardTarget(row: ChargeCardTargetRow): ChargeCardTarget {
  return {
    kind: 'chargeCard',
    id: row.id,
    coopId: row.coopId,
    shareholderId: row.shareholderId,
    status: row.status,
    feeInclVat: Number(row.feeInclVat),
    ogmCode: row.ogmCode,
  };
}

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

  /**
   * Resolves many OGMs in one query per target table (the CSV import batch).
   * Inputs may be formatted or digit-only; invalid ones are dropped. Keys are
   * the formatted codes, as stored.
   */
  async resolveOgmTargets(
    coopId: string,
    ogms: Array<string | null | undefined>,
  ): Promise<Map<string, PaymentTarget>> {
    const codes = [
      ...new Set(ogms.map((ogm) => extractOgmCode(ogm)).filter((ogm): ogm is string => ogm !== null)),
    ];
    const targets = new Map<string, PaymentTarget>();
    if (codes.length === 0) return targets;

    const [registrations, chargeCards] = await Promise.all([
      this.prisma.registration.findMany({
        where: { coopId, ogmCode: { in: codes } },
        select: REGISTRATION_TARGET_SELECT,
      }),
      this.prisma.chargeCard.findMany({
        where: { coopId, ogmCode: { in: codes } },
        select: CHARGE_CARD_TARGET_SELECT,
      }),
    ]);
    for (const row of registrations) {
      if (row.ogmCode) targets.set(row.ogmCode, toRegistrationTarget(row));
    }
    // Same precedence as resolveOgmTarget: a registration wins over a card.
    for (const row of chargeCards) {
      if (!targets.has(row.ogmCode)) targets.set(row.ogmCode, toChargeCardTarget(row));
    }
    return targets;
  }

  /** Resolves one OGM (Ponto, rematch), with the same normalisation. */
  async resolveOgmTarget(coopId: string, ogm: string | null | undefined): Promise<PaymentTarget | null> {
    const ogmCode = extractOgmCode(ogm);
    if (!ogmCode) return null;
    const registration = await this.prisma.registration.findFirst({
      where: { coopId, ogmCode },
      select: REGISTRATION_TARGET_SELECT,
    });
    if (registration) return toRegistrationTarget(registration);
    const card = await this.prisma.chargeCard.findFirst({
      where: { coopId, ogmCode },
      select: CHARGE_CARD_TARGET_SELECT,
    });
    return card ? toChargeCardTarget(card) : null;
  }

  /** Looks a charge card up by id, scoped to the coop (manual match). */
  async findChargeCardTarget(coopId: string, cardId: string): Promise<ChargeCardTarget | null> {
    const card = await this.prisma.chargeCard.findFirst({
      where: { id: cardId, coopId },
      select: CHARGE_CARD_TARGET_SELECT,
    });
    return card ? toChargeCardTarget(card) : null;
  }

  /** True if some row already holds this OGM code. */
  private async isOgmCodeTaken(db: Prisma.TransactionClient, code: string): Promise<boolean> {
    if ((await db.registration.findFirst({ where: { ogmCode: code }, select: { id: true } })) !== null) {
      return true;
    }
    return (await db.chargeCard.findFirst({ where: { ogmCode: code }, select: { id: true } })) !== null;
  }
}
