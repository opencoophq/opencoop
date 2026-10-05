import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateCoopDto } from './update-coop.dto';

describe('UpdateCoopDto charge-card fields', () => {
  async function errorsFor(payload: Record<string, unknown>) {
    return validate(plainToInstance(UpdateCoopDto, payload));
  }

  it('accepts the Bronsgroen values', async () => {
    expect(
      await errorsFor({ chargeCardsEnabled: true, chargeCardFee: 6, chargeCardReplacementFee: 12, chargeCardVatRate: 21 }),
    ).toHaveLength(0);
  });

  it('rejects a zero fee', async () => {
    const errors = await errorsFor({ chargeCardFee: 0 });
    expect(errors.some((e) => e.property === 'chargeCardFee')).toBe(true);
  });

  it('rejects a fee with more than two decimals', async () => {
    const errors = await errorsFor({ chargeCardReplacementFee: 12.005 });
    expect(errors.some((e) => e.property === 'chargeCardReplacementFee')).toBe(true);
  });

  it('rejects a VAT rate above 100', async () => {
    const errors = await errorsFor({ chargeCardVatRate: 121 });
    expect(errors.some((e) => e.property === 'chargeCardVatRate')).toBe(true);
  });
});
