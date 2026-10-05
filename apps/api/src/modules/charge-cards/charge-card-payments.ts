import { Prisma } from '@opencoop/database';
import { computeTotalPaid } from '@opencoop/shared';
import { ChargeCardTarget, toCents } from '../ogm/payment-target';

export interface ChargeCardPaymentInput {
  amount: number;
  bankDate: Date;
  bankTransactionId?: string | null;
  matchedByUserId?: string | null;
}

/**
 * Books a payment on a REQUESTED charge card inside the caller's transaction.
 * The card moves to PAID once its payments reach feeInclVat (in cents). The
 * status update is guarded on REQUESTED, so a card cancelled in the meantime
 * stays CANCELLED (paid = false) and an admin refunds the money.
 */
export async function recordChargeCardPayment(
  tx: Prisma.TransactionClient,
  card: ChargeCardTarget,
  input: ChargeCardPaymentInput,
) {
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
  if (toCents(computeTotalPaid(payments)) < toCents(card.feeInclVat)) {
    return { payment, paid: false };
  }

  const result = await tx.chargeCard.updateMany({
    where: { id: card.id, status: 'REQUESTED' },
    data: { status: 'PAID', paidAt: new Date() },
  });
  return { payment, paid: result.count === 1 };
}
