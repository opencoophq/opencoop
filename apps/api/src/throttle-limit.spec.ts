import { apiThrottleLimit, DEFAULT_API_THROTTLE_LIMIT } from './throttle-limit';

describe('apiThrottleLimit', () => {
  it('defaults to 100 when the env var is missing or blank', () => {
    expect(apiThrottleLimit({})).toBe(DEFAULT_API_THROTTLE_LIMIT);
    expect(apiThrottleLimit({ API_THROTTLE_LIMIT: '  ' })).toBe(DEFAULT_API_THROTTLE_LIMIT);
  });

  it('accepts a positive integer override', () => {
    expect(apiThrottleLimit({ API_THROTTLE_LIMIT: '10000' })).toBe(10000);
  });

  it('ignores zero, fractions and non-numeric values', () => {
    expect(apiThrottleLimit({ API_THROTTLE_LIMIT: '0' })).toBe(DEFAULT_API_THROTTLE_LIMIT);
    expect(apiThrottleLimit({ API_THROTTLE_LIMIT: '1.5' })).toBe(DEFAULT_API_THROTTLE_LIMIT);
    expect(apiThrottleLimit({ API_THROTTLE_LIMIT: 'lots' })).toBe(DEFAULT_API_THROTTLE_LIMIT);
  });
});
