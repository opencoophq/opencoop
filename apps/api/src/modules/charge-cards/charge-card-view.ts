import type { ChargeCard } from '@opencoop/database';

export function shareholderDisplayName(sh: {
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  return sh.companyName || [sh.firstName, sh.lastName].filter(Boolean).join(' ');
}

export interface ChargeCardView {
  id: string;
  label: string | null;
  status: ChargeCard['status'];
  blockReason: ChargeCard['blockReason'];
  ogmCode: string;
  cardNumber: string | null;
  feeInclVat: number;
  isReplacement: boolean;
  replacesCardId: string | null;
  replaced: boolean;
  providerSyncNeeded: boolean;
  requestedAt: Date;
  paidAt: Date | null;
  issuedAt: Date | null;
  blockedAt: Date | null;
  activatedAt: Date | null;
}

export function toChargeCardView(card: ChargeCard & { replacedBy?: { id: string } | null }): ChargeCardView {
  return {
    id: card.id,
    label: card.label,
    status: card.status,
    blockReason: card.blockReason,
    ogmCode: card.ogmCode,
    cardNumber: card.cardNumber,
    feeInclVat: Number(card.feeInclVat),
    isReplacement: card.isReplacement,
    replacesCardId: card.replacesCardId,
    replaced: Boolean(card.replacedBy),
    providerSyncNeeded: card.providerSyncNeeded,
    requestedAt: card.requestedAt,
    paidAt: card.paidAt,
    issuedAt: card.issuedAt,
    blockedAt: card.blockedAt,
    activatedAt: card.activatedAt,
  };
}
