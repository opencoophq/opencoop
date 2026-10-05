import type { ChargeCardStatus } from '@opencoop/database';

/**
 * Something a bank payment can be booked on. A registration keeps the shape
 * BankMatchingService works with; a charge card carries its frozen fee.
 */
export interface RegistrationTarget {
  kind: 'registration';
  id: string;
  coopId: string;
  status: string;
  totalAmount?: unknown;
  ogmCode?: string | null;
  payments?: { id: string; amount: unknown; bankDate: Date; bankTransactionId: string | null }[];
}

export interface ChargeCardTarget {
  kind: 'chargeCard';
  id: string;
  coopId: string;
  shareholderId: string;
  status: ChargeCardStatus;
  feeInclVat: number;
  ogmCode: string;
}

export type PaymentTarget = RegistrationTarget | ChargeCardTarget;

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * True when CSV import, Ponto or rematch may book this amount on the card
 * without an admin: the card is REQUESTED and the amount covers its fee.
 * Short payments and payments for any other state stay UNMATCHED.
 */
export function acceptsCardPayment(card: ChargeCardTarget, amount: number): boolean {
  return card.status === 'REQUESTED' && toCents(amount) >= toCents(card.feeInclVat);
}
