/**
 * Something a bank payment can be booked on, in the shape BankMatchingService
 * works with. Task 5 adds charge cards.
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

export type PaymentTarget = RegistrationTarget;
