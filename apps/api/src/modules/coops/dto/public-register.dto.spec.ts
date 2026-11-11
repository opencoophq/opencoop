import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PublicRegisterDto } from './public-register.dto';

describe('PublicRegisterDto quantity', () => {
  async function quantityErrors(quantity: unknown) {
    const errors = await validate(plainToInstance(PublicRegisterDto, { quantity }));
    return errors.filter((e) => e.property === 'quantity');
  }

  it('accepts a whole number of shares', async () => {
    expect(await quantityErrors(3)).toHaveLength(0);
  });

  it('rejects a fractional quantity that Prisma would fail on', async () => {
    expect(await quantityErrors(1.5)).toHaveLength(1);
  });

  it('rejects zero and negative quantities', async () => {
    expect(await quantityErrors(0)).toHaveLength(1);
    expect(await quantityErrors(-2)).toHaveLength(1);
  });
});
