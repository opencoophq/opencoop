import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AddPaymentDto } from './add-payment.dto';

describe('AddPaymentDto validation', () => {
  async function errorsFor(payload: Record<string, unknown>) {
    const dto = plainToInstance(AddPaymentDto, payload);
    return validate(dto);
  }

  it('accepts a positive amount with a valid bankDate', async () => {
    const errors = await errorsFor({ amount: 50, bankDate: '2026-01-01' });
    expect(errors).toHaveLength(0);
  });

  it('rejects a negative amount', async () => {
    const errors = await errorsFor({ amount: -5, bankDate: '2026-01-01' });
    expect(errors.some((e) => e.property === 'amount')).toBe(true);
  });

  it('rejects a zero amount', async () => {
    const errors = await errorsFor({ amount: 0, bankDate: '2026-01-01' });
    expect(errors.some((e) => e.property === 'amount')).toBe(true);
  });

  it('rejects a non-numeric amount', async () => {
    const errors = await errorsFor({ amount: 'NaN', bankDate: '2026-01-01' });
    expect(errors.some((e) => e.property === 'amount')).toBe(true);
  });

  it('rejects a missing/invalid bankDate', async () => {
    const errors = await errorsFor({ amount: 50 });
    expect(errors.some((e) => e.property === 'bankDate')).toBe(true);

    const errors2 = await errorsFor({ amount: 50, bankDate: 'not-a-date' });
    expect(errors2.some((e) => e.property === 'bankDate')).toBe(true);
  });
});
