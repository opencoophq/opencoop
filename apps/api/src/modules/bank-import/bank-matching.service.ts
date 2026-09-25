import { Injectable } from '@nestjs/common';
import { computeTotalPaid, extractOgmCode } from '@opencoop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';

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

export interface BankMatchingRegistration {
  id: string;
  coopId: string;
  status: string;
  totalAmount?: unknown;
  payments?: { id: string; amount: unknown; bankDate: Date; bankTransactionId: string | null }[];
}

class LinkConflictError extends Error {}

@Injectable()
export class BankMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async matchTransaction(
    coopId: string,
    transaction: BankTransactionMatchInput,
    matchedByUserId?: string,
    allowCreate = true,
    registrationOverride?: BankMatchingRegistration,
  ): Promise<BankTransactionMatchResult> {
    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
    }

    const ogmCode = extractOgmCode(transaction.ogmCode, transaction.referenceText);
    if (!ogmCode) {
      return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
    }

    const registration = registrationOverride || await this.prisma.registration.findFirst({
      where: { coopId, ogmCode },
      select: {
        id: true,
        coopId: true,
        status: true,
        totalAmount: true,
        payments: {
          select: { id: true, amount: true, bankDate: true, bankTransactionId: true },
        },
      },
    });
    if (!registration) {
      return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
    }

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
      if (registrationOverride?.payments) {
        const linkedPayment = registrationOverride.payments.find((payment) => payment.id === closestPayment.id);
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
    if (registrationOverride?.payments) {
      registrationOverride.payments.push({
        id: createdPayment?.id || `created-${transaction.id}`,
        amount,
        bankDate: transaction.date,
        bankTransactionId: transaction.id,
      });
      if (
        registrationOverride.totalAmount !== undefined &&
        computeTotalPaid(registrationOverride.payments.map((payment) => ({ amount: Number(payment.amount) }))) >=
          Number(registrationOverride.totalAmount)
      ) {
        registrationOverride.status = 'COMPLETED';
      } else if (registrationOverride.status === 'PENDING_PAYMENT') {
        registrationOverride.status = 'ACTIVE';
      }
    }
    await this.prisma.bankTransaction.update({
      where: { id: transaction.id },
      data: { matchStatus: 'AUTO_MATCHED', ogmCode },
    });

    return { status: 'AUTO_MATCHED', linkedExisting: false, createdPayment: true };
  }

  private toCents(amount: number): number {
    return Math.round(amount * 100);
  }

  private dateDistance(left: Date, right: Date): number {
    return Math.abs(new Date(left).getTime() - new Date(right).getTime());
  }
}
