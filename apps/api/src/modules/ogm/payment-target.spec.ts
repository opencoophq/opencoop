import { ChargeCardTarget, acceptsCardPayment, toCents } from './payment-target';

const card = (overrides: Partial<ChargeCardTarget> = {}): ChargeCardTarget => ({
  kind: 'chargeCard',
  id: 'card-1',
  coopId: 'coop-1',
  shareholderId: 'sh-1',
  status: 'REQUESTED',
  feeInclVat: 6,
  ogmCode: '+++090/9337/55493+++',
  ...overrides,
});

describe('acceptsCardPayment', () => {
  it('accepts a REQUESTED card paid in full', () => {
    expect(acceptsCardPayment(card(), 6)).toBe(true);
  });

  it('accepts an overpayment', () => {
    expect(acceptsCardPayment(card(), 10)).toBe(true);
  });

  it('refuses a short payment', () => {
    expect(acceptsCardPayment(card(), 5.99)).toBe(false);
  });

  it('compares in cents, not floats', () => {
    expect(acceptsCardPayment(card({ feeInclVat: 6.05 }), 0.1 + 0.2 + 5.75)).toBe(true);
  });

  it.each(['PAID', 'ACTIVE', 'BLOCKED', 'CANCELLED'] as const)('refuses a %s card', (status) => {
    expect(acceptsCardPayment(card({ status }), 6)).toBe(false);
  });
});

describe('toCents', () => {
  it('rounds to whole cents', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(12)).toBe(1200);
  });
});
