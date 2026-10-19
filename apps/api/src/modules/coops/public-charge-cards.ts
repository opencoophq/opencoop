export interface PublicChargeCards {
  feeInclVat: string;
  replacementFeeInclVat: string;
}

/**
 * Public price list for the charge-card entry page. Null when the coop has
 * not enabled the feature, so a disabled coop does not advertise a fee.
 */
export function publicChargeCards(coop: {
  chargeCardsEnabled: boolean;
  chargeCardFee: { toString(): string } | string | number | null | undefined;
  chargeCardReplacementFee: { toString(): string } | string | number | null | undefined;
}): PublicChargeCards | null {
  if (!coop.chargeCardsEnabled) return null;
  if (coop.chargeCardFee == null || coop.chargeCardReplacementFee == null) return null;
  return {
    feeInclVat: String(coop.chargeCardFee),
    replacementFeeInclVat: String(coop.chargeCardReplacementFee),
  };
}
