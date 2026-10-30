import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// Regression for #249: @hookform/resolvers v3 did not recognise zod v4 errors and
// rethrew them, so an empty required field crashed the form instead of showing a message.
describe('zodResolver with zod v4', () => {
  const schema = z.object({ password: z.string().min(1) });
  const resolve = (values: { password: string }) =>
    zodResolver(schema)(values, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });

  it('returns field errors for an empty password instead of throwing', async () => {
    const result = await resolve({ password: '' });

    expect(result.values).toEqual({});
    expect(result.errors.password).toMatchObject({ type: 'too_small' });
  });

  it('returns the values for a valid password', async () => {
    const result = await resolve({ password: 'secret' });

    expect(result).toEqual({ values: { password: 'secret' }, errors: {} });
  });
});
