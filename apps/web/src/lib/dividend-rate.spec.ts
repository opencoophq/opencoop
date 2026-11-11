import { dividendFractionToPercentInput, dividendPercentToFraction } from './dividend-rate';

describe('share-class dividend rate units', () => {
  it('stores 3.5% as 0.035, not 3.5', () => {
    expect(dividendPercentToFraction(3.5)).toBe(0.035);
    expect(dividendPercentToFraction(4)).toBe(0.04);
  });

  it('shows a stored fraction in the percent field', () => {
    expect(dividendFractionToPercentInput(0.035)).toBe('3.5');
    expect(dividendFractionToPercentInput(0.04)).toBe('4');
  });

  it('round-trips a percent through storage', () => {
    expect(dividendFractionToPercentInput(dividendPercentToFraction(3.25))).toBe('3.25');
  });

  it('leaves a blank field when there is no override', () => {
    expect(dividendFractionToPercentInput(0)).toBe('');
    expect(dividendFractionToPercentInput(Number.NaN)).toBe('');
  });
});
