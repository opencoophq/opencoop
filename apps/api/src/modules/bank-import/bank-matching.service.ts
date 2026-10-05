import { Injectable } from '@nestjs/common';
import { computeTotalPaid, extractOgmCode } from '@opencoop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { OgmService } from '../ogm/ogm.service';
import { ChargeCardTarget, PaymentTarget, acceptsCardPayment } from '../ogm/payment-target';
import { recordChargeCardPayment } from '../charge-cards/charge-card-payments';

export interface BankTransactionMatchInput {
  id: string;
  date: Date;
  amount: number | string | { toString(): string };
  referenceText?: string | null;
  ogmCode?: string | null;
}

export interface BankTransactionMatchResult {
  status: 'AUTO_MATCHED' | 'UNMATCHED';
  linkedExisting: boolean;
  createdPayment: boolean;
}

class LinkConflictError extends Error {}

@Injectable()
export class BankMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly ogm: OgmService,
  ) {}

  async matchTransaction(
    coopId: string,
    transaction: BankTransactionMatchInput,
    matchedByUserId?: string,
    allowCreate = true,
    targetOverride?: PaymentTarget,
  ): Promise<BankTransactionMatchResult> {
    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
    }

    const ogmCode = extractOgmCode(transaction.ogmCode, transaction.referenceText);
    if (!ogmCode) {
      return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
    }

    // One resolver for every OGM. The CSV import passes the target it batch-loaded
    // (targetOverride) and reuses that object for later rows of the same file, so the
    // updates to `cached` below keep it current. A freshly resolved target is not cached.
    const target = targetOverride ?? (await this.ogm.resolveOgmTarget(coopId, ogmCode));
    if (!target) {
      return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
    }
    if (target.kind === 'chargeCard') {
      return this.matchChargeCard(target, transaction, ogmCode, amount, matchedByUserId, allowCreate);
    }
    const registration = target;
    const cached = targetOverride ? registration : undefined;

    const unlinkedPayments = registration.payments
      ? registration.payments.filter((payment) => payment.bankTransactionId === null)
      : await this.prisma.payment.findMany({
          where: { registrationId: registration.id, coopId, bankTransactionId: null },
          select: { id: true, amount: true, bankDate: true },
        });
    const amountInCents = this.toCents(amount);
    const equalPayments = unlinkedPayments.filter(
      (payment) => this.toCents(Number(payment.amount)) === amountInCents,
    );

    if (equalPayments.length > 0) {
      const closestPayment = equalPayments.reduce((closest, payment) => {
        const closestDistance = this.dateDistance(closest.bankDate, transaction.date);
        const paymentDistance = this.dateDistance(payment.bankDate, transaction.date);
        return paymentDistance < closestDistance ? payment : closest;
      });

      // Claim the payment and the bank row only while both are still free: a concurrent
      // linker (Ponto sync, rematch, another admin) must not silently overwrite the link.
      const linked = await this.prisma
        .$transaction(async (tx) => {
          const claimedPayment = await tx.payment.updateMany({
            where: { id: closestPayment.id, bankTransactionId: null },
            data: { bankTransactionId: transaction.id, matchedAt: new Date() },
          });
          const claimedTransaction = await tx.bankTransaction.updateMany({
            where: { id: transaction.id, matchStatus: 'UNMATCHED' },
            data: { matchStatus: 'AUTO_MATCHED', ogmCode },
          });
          if (claimedPayment.count !== 1 || claimedTransaction.count !== 1) {
            throw new LinkConflictError();
          }
        })
        .then(() => true)
        .catch((error: unknown) => {
          if (error instanceof LinkConflictError) return false;
          throw error;
        });
      if (!linked) {
        return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
      }
      if (cached?.payments) {
        const linkedPayment = cached.payments.find((payment) => payment.id === closestPayment.id);
        if (linkedPayment) linkedPayment.bankTransactionId = transaction.id;
      }

      return { status: 'AUTO_MATCHED', linkedExisting: true, createdPayment: false };
    }

    if (!allowCreate || !['PENDING_PAYMENT', 'ACTIVE'].includes(registration.status)) {
      return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
    }

    const createdPayment = await this.paymentsService.addPayment({
      registrationId: registration.id,
      coopId,
      amount,
      bankDate: transaction.date,
      bankTransactionId: transaction.id,
      ...(matchedByUserId ? { matchedByUserId } : {}),
    });
    if (cached?.payments) {
      cached.payments.push({
        id: createdPayment?.id || `created-${transaction.id}`,
        amount,
        bankDate: transaction.date,
        bankTransactionId: transaction.id,
      });
      if (
        cached.totalAmount !== undefined &&
        computeTotalPaid(cached.payments.map((payment) => ({ amount: Number(payment.amount) }))) >=
          Number(cached.totalAmount)
      ) {
        cached.status = 'COMPLETED';
      } else if (cached.status === 'PENDING_PAYMENT') {
        cached.status = 'ACTIVE';
      }
    }
    await this.prisma.bankTransaction.update({
      where: { id: transaction.id },
      data: { matchStatus: 'AUTO_MATCHED', ogmCode },
    });

    return { status: 'AUTO_MATCHED', linkedExisting: false, createdPayment: true };
  }

  /**
   * A charge card takes a payment only while REQUESTED and only for at least its
   * fee. Anything else stays UNMATCHED for an admin (refund or manual match).
   */
  private async matchChargeCard(
    card: ChargeCardTarget,
    transaction: BankTransactionMatchInput,
    ogmCode: string,
    amount: number,
    matchedByUserId: string | undefined,
    allowCreate: boolean,
  ): Promise<BankTransactionMatchResult> {
    if (!allowCreate || !acceptsCardPayment(card, amount)) {
      return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
    }

    const paid = await this.prisma
      .$transaction(async (tx) => {
        // Claim the bank row first, so a concurrent linker cannot book it twice.
        const claimed = await tx.bankTransaction.updateMany({
          where: { id: transaction.id, matchStatus: 'UNMATCHED' },
          data: { matchStatus: 'AUTO_MATCHED', ogmCode },
        });
        if (claimed.count !== 1) throw new LinkConflictError();
        const result = await recordChargeCardPayment(tx, card, {
          amount,
          bankDate: transaction.date,
          bankTransactionId: transaction.id,
          matchedByUserId,
        });
        return result.paid;
      })
      .catch((error: unknown) => {
        if (error instanceof LinkConflictError) return null;
        throw error;
      });
    if (paid === null) {
      return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
    }

    // The CSV import reuses this object for later rows: a second transfer must see PAID.
    if (paid) card.status = 'PAID';
    return { status: 'AUTO_MATCHED', linkedExisting: false, createdPayment: true };
  }

  private toCents(amount: number): number {
    return Math.round(amount * 100);
  }

  private dateDistance(left: Date, right: Date): number {
    return Math.abs(new Date(left).getTime() - new Date(right).getTime());
  }
}
