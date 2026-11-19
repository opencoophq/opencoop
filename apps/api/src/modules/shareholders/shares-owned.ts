import { computeTotalPaid, computeVestedShares } from '@opencoop/shared';

/**
 * SELL statuses that commit shares of a BUY: they count against the BUY whether the
 * sale is pending or done. Same set as RegistrationsService.getAvailableShares.
 */
export const COMMITTED_SELL_STATUSES = [
  'PENDING',
  'PENDING_PAYMENT',
  'ACTIVE',
  'COMPLETED',
] as const;

/** Prisma include/select for the SELLs that count against a BUY registration. */
export const committedSoldBySelect = {
  where: { type: 'SELL' as const, status: { in: [...COMMITTED_SELL_STATUSES] } },
  select: { quantity: true, status: true },
};

/** BUY statuses whose owned shares count as the shareholder's holding. */
export const HELD_BUY_STATUSES: readonly string[] = ['ACTIVE', 'COMPLETED'];

export interface BuyForSharesOwned {
  quantity: number;
  pricePerShare: number | string | { toString(): string };
  payments: { amount: number | string | { toString(): string } }[];
  soldBy?: { quantity: number; status: string }[] | null;
}

/**
 * Shares a shareholder owns through one BUY registration: the paid (vested) shares
 * minus the shares committed to SELLs that reference this BUY via sellsRegistrationId.
 */
export function computeBuySharesOwned(reg: BuyForSharesOwned): {
  sharesOwned: number;
  sharesRemaining: number;
} {
  const vestedShares = computeVestedShares(
    computeTotalPaid(reg.payments),
    Number(reg.pricePerShare),
    reg.quantity,
  );
  const soldQty = (reg.soldBy ?? [])
    .filter((s) => (COMMITTED_SELL_STATUSES as readonly string[]).includes(s.status))
    .reduce((sum, s) => sum + s.quantity, 0);
  return {
    sharesOwned: Math.max(0, vestedShares - soldQty),
    sharesRemaining: reg.quantity - vestedShares,
  };
}
