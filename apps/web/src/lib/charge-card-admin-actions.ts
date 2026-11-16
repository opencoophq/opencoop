export type ChargeCardAdminAction =
  | 'mark-paid'
  | 'issue'
  | 'block'
  | 'unblock'
  | 'mark-lost'
  | 'cancel'
  | 'provider-sync-done';

export interface ChargeCardActionPermissions {
  /** canManageShareholders: every card action. */
  canManageAll: boolean;
  /** canManageChargeCards (or canManageAll): mark paid and issue only. */
  canHandOut: boolean;
}

export interface ChargeCardActionState {
  status: 'REQUESTED' | 'PAID' | 'ACTIVE' | 'BLOCKED' | 'CANCELLED';
  blockReason: 'NO_SHARES' | 'LOST' | 'ADMIN' | null;
  providerSyncNeeded: boolean;
}

/**
 * The actions the admin charge-card table shows for one card, in display order.
 * The API applies the same permission split (charge-cards-admin.controller.ts).
 */
export function chargeCardActions(
  card: ChargeCardActionState,
  perms: ChargeCardActionPermissions,
): ChargeCardAdminAction[] {
  const actions: ChargeCardAdminAction[] = [];
  const handOut = perms.canHandOut || perms.canManageAll;
  if (handOut && card.status === 'REQUESTED') actions.push('mark-paid');
  if (handOut && card.status === 'PAID') actions.push('issue');
  if (!perms.canManageAll) return actions;
  if (card.status === 'ACTIVE') actions.push('block');
  if (card.status === 'BLOCKED' && card.blockReason === 'ADMIN') actions.push('unblock');
  if (card.status === 'ACTIVE' || (card.status === 'BLOCKED' && card.blockReason !== 'LOST')) {
    actions.push('mark-lost');
  }
  if (card.status === 'REQUESTED' || card.status === 'PAID') actions.push('cancel');
  if (card.providerSyncNeeded) actions.push('provider-sync-done');
  return actions;
}
