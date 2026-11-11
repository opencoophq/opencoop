import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateShareClassDto } from './create-share-class.dto';

describe('CreateShareClassDto dividendRateOverride', () => {
  async function rateErrors(dividendRateOverride: number) {
    const errors = await validate(
      plainToInstance(CreateShareClassDto, {
        name: 'A',
        code: 'A',
        pricePerShare: 250,
        dividendRateOverride,
      }),
    );
    return errors.filter((e) => e.property === 'dividendRateOverride');
  }

  it('accepts a fraction such as 3.5%', async () => {
    expect(await rateErrors(0.035)).toHaveLength(0);
    expect(await rateErrors(1)).toHaveLength(0);
  });

  it('rejects a percent-shaped value that would pay 350%', async () => {
    expect(await rateErrors(3.5)).toHaveLength(1);
  });
});
