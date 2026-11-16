import { chargeCardActions, ChargeCardActionState } from './charge-card-admin-actions';

const card = (
  status: ChargeCardActionState['status'],
  extra: Partial<ChargeCardActionState> = {},
): ChargeCardActionState => ({ status, blockReason: null, providerSyncNeeded: false, ...extra });

const MANAGE_ALL = { canManageAll: true, canHandOut: true };
const HAND_OUT = { canManageAll: false, canHandOut: true };
const VIEW_ONLY = { canManageAll: false, canHandOut: false };

describe('chargeCardActions', () => {
  it('gives canManageChargeCards only mark-paid and issue', () => {
    expect(chargeCardActions(card('REQUESTED'), HAND_OUT)).toEqual(['mark-paid']);
    expect(chargeCardActions(card('PAID', { providerSyncNeeded: true }), HAND_OUT)).toEqual([
      'issue',
    ]);
    expect(chargeCardActions(card('ACTIVE', { providerSyncNeeded: true }), HAND_OUT)).toEqual([]);
    expect(chargeCardActions(card('BLOCKED', { blockReason: 'ADMIN' }), HAND_OUT)).toEqual([]);
    expect(chargeCardActions(card('CANCELLED'), HAND_OUT)).toEqual([]);
  });

  it('gives a view-only admin no actions', () => {
    for (const status of ['REQUESTED', 'PAID', 'ACTIVE', 'BLOCKED', 'CANCELLED'] as const) {
      expect(chargeCardActions(card(status, { providerSyncNeeded: true }), VIEW_ONLY)).toEqual([]);
    }
  });

  it('gives canManageShareholders every action that fits the card', () => {
    expect(chargeCardActions(card('REQUESTED'), MANAGE_ALL)).toEqual(['mark-paid', 'cancel']);
    expect(chargeCardActions(card('PAID'), MANAGE_ALL)).toEqual(['issue', 'cancel']);
    expect(chargeCardActions(card('ACTIVE', { providerSyncNeeded: true }), MANAGE_ALL)).toEqual([
      'block',
      'mark-lost',
      'provider-sync-done',
    ]);
    expect(chargeCardActions(card('BLOCKED', { blockReason: 'ADMIN' }), MANAGE_ALL)).toEqual([
      'unblock',
      'mark-lost',
    ]);
    expect(chargeCardActions(card('BLOCKED', { blockReason: 'LOST' }), MANAGE_ALL)).toEqual([]);
    expect(chargeCardActions(card('BLOCKED', { blockReason: 'NO_SHARES' }), MANAGE_ALL)).toEqual([
      'mark-lost',
    ]);
  });

  it('treats canManageAll as including hand-out even if canHandOut is false', () => {
    expect(chargeCardActions(card('PAID'), { canManageAll: true, canHandOut: false })).toEqual([
      'issue',
      'cancel',
    ]);
  });
});
