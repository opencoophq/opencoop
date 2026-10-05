import { ChargeCardStatus, Prisma } from '@opencoop/database';
import { ChargeCardTarget, toCents } from '../ogm/payment-target';
import { transitionCard } from './charge-card-transition';

export interface ChargeCardPaymentInput {
  amount: number;
  bankDate: Date;
  bankTransactionId?: string | null;
  matchedByUserId?: string | null;
}

/** The card was no longer REQUESTED once its row was locked. Nothing was written. */
export class ChargeCardNotPayableError extends Error {
  constructor(readonly status: ChargeCardStatus | null) {
    super(`Charge card is ${status ?? 'gone'}, not REQUESTED`);
  }
}

/**
 * Books a payment on a REQUESTED charge card inside the caller's transaction.
 *
 * The card row is locked first (FOR UPDATE), so payers and a cancel on the same
 * card run one after the other, and the status is re-read under that lock: a
 * card that is no longer REQUESTED throws ChargeCardNotPayableError before any
 * payment is written. The payments are summed under the lock, in cents, so two
 * partial payments can never both miss the fee. The REQUESTED → PAID step goes
 * through transitionCard; a refusal throws and rolls the payment back.
 */
export async function recordChargeCardPayment(
  tx: Prisma.TransactionClient,
  card: ChargeCardTarget,
  input: ChargeCardPaymentInput,
) {
  const locked = await tx.$queryRaw<{ status: ChargeCardStatus }[]>`
    SELECT "status" FROM "charge_cards"
    WHERE "id" = ${card.id} AND "coopId" = ${card.coopId}
    FOR UPDATE`;
  const status = locked[0]?.status ?? null;
  if (status !== 'REQUESTED') {
    throw new ChargeCardNotPayableError(status);
  }

  const payment = await tx.payment.create({
    data: {
      chargeCardId: card.id,
      coopId: card.coopId,
      amount: input.amount,
      bankDate: input.bankDate,
      bankTransactionId: input.bankTransactionId ?? null,
      matchedByUserId: input.matchedByUserId ?? null,
      matchedAt: new Date(),
    },
  });

  const payments = await tx.payment.findMany({ where: { chargeCardId: card.id }, select: { amount: true } });
  const paidCents = payments.reduce((sum, row) => sum + toCents(Number(row.amount)), 0);
  if (paidCents < toCents(card.feeInclVat)) {
    return { payment, paid: false };
  }

  await transitionCard(
    tx,
    { id: card.id, coopId: card.coopId },
    { status: 'REQUESTED' },
    { status: 'PAID', paidAt: new Date() },
    'Only a requested charge card can be marked paid',
  );
  return { payment, paid: true };
}
