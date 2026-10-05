import { isSilentChargeCardsLoadFailure, isValidAmount } from './charge-cards-validation';

describe('isValidAmount', () => {
  it('accepts a plain positive integer', () => {
    expect(isValidAmount('6')).toBe(true);
  });

  it('accepts up to 2 decimals', () => {
    expect(isValidAmount('6.5')).toBe(true);
    expect(isValidAmount('6.00')).toBe(true);
  });

  it('rejects more than 2 decimals', () => {
    expect(isValidAmount('6.005')).toBe(false);
  });

  it('rejects an empty or blank field', () => {
    expect(isValidAmount('')).toBe(false);
    expect(isValidAmount('   ')).toBe(false);
  });

  it('rejects zero and negative amounts under the default 0.01 minimum', () => {
    expect(isValidAmount('0')).toBe(false);
    expect(isValidAmount('-1')).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(isValidAmount('abc')).toBe(false);
    expect(isValidAmount('6abc')).toBe(false);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isValidAmount('  6.00  ')).toBe(true);
  });

  it('allows zero when min is explicitly 0 (VAT rate)', () => {
    expect(isValidAmount('0', { min: 0 })).toBe(true);
  });

  it('rejects a value above an explicit max (VAT rate capped at 100)', () => {
    expect(isValidAmount('100', { min: 0, max: 100 })).toBe(true);
    expect(isValidAmount('100.01', { min: 0, max: 100 })).toBe(false);
    expect(isValidAmount('121', { min: 0, max: 100 })).toBe(false);
  });
});

describe('isSilentChargeCardsLoadFailure', () => {
  it('treats 403 (no canManageShareholders) as silent', () => {
    expect(isSilentChargeCardsLoadFailure(403)).toBe(true);
  });

  it('treats 404 (feature not reachable) as silent', () => {
    expect(isSilentChargeCardsLoadFailure(404)).toBe(true);
  });

  it('does not treat a 500 as silent', () => {
    expect(isSilentChargeCardsLoadFailure(500)).toBe(false);
  });

  it('does not treat a missing status (network error) as silent', () => {
    expect(isSilentChargeCardsLoadFailure(undefined)).toBe(false);
  });
});
