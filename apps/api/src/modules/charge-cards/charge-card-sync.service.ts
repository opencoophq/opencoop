import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { PrismaService } from '../../prisma/prisma.service';
import { cancelCard, lockCard } from './charge-card-transition';

/** Unreachable in practice: cancelOpenRequests re-checks the locked status is REQUESTED before calling cancelCard. */
const CANCEL_REFUSAL = 'Only a requested card can be cancelled';

export interface ChargeCardSyncResult {
  blocked: number;
  unblocked: number;
  cancelled: number;
}

/**
 * Keeps charge cards in line with shareholder status (state, not events):
 * - ACTIVE card, shareholder not ACTIVE        → BLOCKED / NO_SHARES
 * - BLOCKED / NO_SHARES, shareholder ACTIVE    → ACTIVE (activatedAt = now)
 * - REQUESTED card, shareholder not ACTIVE,
 *   and the card holds no payment            → CANCELLED
 * - REQUESTED card, shareholder not ACTIVE,
 *   but the card already holds a payment     → left REQUESTED, logged;
 *   money is sitting on it and only an admin can unwind that with a refund.
 * Block and unblock set providerSyncNeeded: in v1 an admin mirrors them in
 * the provider portal.
 */
@Injectable()
export class ChargeCardSyncService {
  private readonly logger = new Logger(ChargeCardSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  syncShareholder(shareholderId: string): Promise<ChargeCardSyncResult> {
    return this.sync({ shareholderId });
  }

  syncAll(): Promise<ChargeCardSyncResult> {
    return this.sync({});
  }

  private async sync(scope: Prisma.ChargeCardWhereInput): Promise<ChargeCardSyncResult> {
    const now = new Date();
    const [blocked, unblocked] = await this.prisma.$transaction([
      this.prisma.chargeCard.updateMany({
        where: { ...scope, status: 'ACTIVE', shareholder: { status: { not: 'ACTIVE' } } },
        data: { status: 'BLOCKED', blockReason: 'NO_SHARES', blockedAt: now, providerSyncNeeded: true },
      }),
      this.prisma.chargeCard.updateMany({
        where: { ...scope, status: 'BLOCKED', blockReason: 'NO_SHARES', shareholder: { status: 'ACTIVE' } },
        data: { status: 'ACTIVE', blockReason: null, blockedAt: null, activatedAt: now, providerSyncNeeded: true },
      }),
    ]);

    const cancelled = await this.cancelOpenRequests(scope);

    const result = { blocked: blocked.count, unblocked: unblocked.count, cancelled };
    if (result.blocked || result.unblocked || result.cancelled) {
      this.logger.log(
        `Charge-card sync: ${result.blocked} blocked, ${result.unblocked} unblocked, ${result.cancelled} cancelled`,
      );
    }
    return result;
  }

  /**
   * A REQUESTED card whose shareholder no longer has shares is cancelled —
   * but only if the card holds no payment yet. A REQUESTED card that already
   * holds a payment is left REQUESTED and logged: money sits on it, and only
   * an admin can unwind that with a refund. Each candidate is locked and
   * re-checked under its own transaction (as every other cancel does), and
   * the cancel itself goes through the shared `cancelCard`, never a literal
   * `updateMany`.
   */
  private async cancelOpenRequests(scope: Prisma.ChargeCardWhereInput): Promise<number> {
    const candidates = await this.prisma.chargeCard.findMany({
      where: { ...scope, status: 'REQUESTED', shareholder: { status: { not: 'ACTIVE' } } },
      select: { id: true, shareholderId: true },
    });

    let cancelled = 0;
    for (const candidate of candidates) {
      const didCancel = await this.prisma.$transaction(async (tx) => {
        const locked = await lockCard(tx, { id: candidate.id, shareholderId: candidate.shareholderId });
        if (!locked || locked.status !== 'REQUESTED') {
          return false;
        }
        const paymentCount = await tx.payment.count({ where: { chargeCardId: candidate.id } });
        if (paymentCount > 0) {
          this.logger.warn(
            `charge card ${candidate.id} (shareholder ${candidate.shareholderId}) is REQUESTED and holds a ` +
              'payment, but its shareholder has no shares; leaving it REQUESTED for an admin to refund',
          );
          return false;
        }
        await cancelCard(
          tx,
          { id: candidate.id, shareholderId: candidate.shareholderId },
          ['REQUESTED'],
          CANCEL_REFUSAL,
        );
        return true;
      });
      if (didCancel) {
        cancelled += 1;
      }
    }
    return cancelled;
  }
}
