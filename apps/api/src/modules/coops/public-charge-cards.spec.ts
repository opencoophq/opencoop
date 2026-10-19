import { publicChargeCards } from './public-charge-cards';

describe('publicChargeCards', () => {
  it('hides fees when the feature is off', () => {
    expect(
      publicChargeCards({
        chargeCardsEnabled: false,
        chargeCardFee: '6.00',
        chargeCardReplacementFee: '12.00',
      }),
    ).toBeNull();
  });

  it('returns the incl-VAT fees as strings when the feature is on', () => {
    expect(
      publicChargeCards({
        chargeCardsEnabled: true,
        chargeCardFee: { toString: () => '6' },
        chargeCardReplacementFee: { toString: () => '12' },
      }),
    ).toEqual({ feeInclVat: '6', replacementFeeInclVat: '12' });
  });

  it('returns null when a fee is missing', () => {
    expect(
      publicChargeCards({
        chargeCardsEnabled: true,
        chargeCardFee: '6',
        chargeCardReplacementFee: null,
      }),
    ).toBeNull();
  });
});
