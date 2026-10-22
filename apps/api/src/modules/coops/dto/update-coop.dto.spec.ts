import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateCoopDto } from './update-coop.dto';

describe('UpdateCoopDto charge-card fields', () => {
  async function errorsFor(payload: Record<string, unknown>) {
    return validate(plainToInstance(UpdateCoopDto, payload));
  }

  it('accepts the Bronsgroen values', async () => {
    expect(
      await errorsFor({
        chargeCardsEnabled: true,
        chargeCardFee: 6,
        chargeCardReplacementFee: 12,
        chargeCardVatRate: 21,
      }),
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

  it('accepts numeric Brevo list ids and null, and rejects anything else', async () => {
    expect(
      await errorsFor({
        brevoMembersListId: '3',
        brevoResignedListId: '9',
        brevoProspectsListId: '42',
      }),
    ).toHaveLength(0);
    expect(
      await errorsFor({
        brevoMembersListId: null,
        brevoResignedListId: null,
        brevoProspectsListId: null,
      }),
    ).toHaveLength(0);
    const errors = await errorsFor({
      brevoMembersListId: '3a',
      brevoResignedListId: 'list-9',
      brevoProspectsListId: 42,
    });
    expect(errors.find((e) => e.property === 'brevoMembersListId')?.constraints?.matches).toBe(
      'Brevo list id must contain only digits',
    );
    expect(errors.find((e) => e.property === 'brevoResignedListId')?.constraints?.matches).toBe(
      'Brevo list id must contain only digits',
    );
    expect(errors.some((e) => e.property === 'brevoProspectsListId')).toBe(true);
  });

  it('rejects a VAT rate above 100', async () => {
    const errors = await errorsFor({ chargeCardVatRate: 121 });
    expect(errors.some((e) => e.property === 'chargeCardVatRate')).toBe(true);
  });
});
