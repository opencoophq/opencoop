import {
  generateOgmCode,
  validateOgmCode,
  formatOgmCode,
  parseOgmCode,
  calculateDividend,
  computeVestedShares,
  computeTotalPaid,
  apportionWithholdingTax,
} from './utils';

describe('OGM mod-97', () => {
  it('round-trips generate → validate', () => {
    for (let seq = 1; seq < 500; seq++) {
      const ogm = generateOgmCode('001', seq);
      expect(validateOgmCode(ogm)).toBe(true);
    }
  });

  it('uses 97 (not 00) when the modulo is zero', () => {
    let hit: string | null = null;
    for (let seq = 1; seq < 10000 && !hit; seq++) {
      const base = '001' + String(seq).padStart(7, '0');
      if (BigInt(base) % 97n === 0n) hit = generateOgmCode('001', seq);
    }
    expect(hit).not.toBeNull();
    expect(hit!.slice(-5, -3)).toBe('97'); // the two check digits in the formatted code
    expect(validateOgmCode(hit!)).toBe(true);
  });

  it('rejects a tampered check digit', () => {
    const ogm = parseOgmCode(generateOgmCode('001', 42));
    const wrong = formatOgmCode(ogm.slice(0, 11) + ((Number(ogm[11]) + 1) % 10));
    expect(validateOgmCode(wrong)).toBe(false);
  });

  it('format/parse are inverse', () => {
    const raw = '123456789012';
    expect(parseOgmCode(formatOgmCode(raw))).toBe(raw);
  });
});

describe('calculateDividend', () => {
  it('rounds gross/tax/net to cents and keeps gross = tax + net', () => {
    const d = calculateDividend(1000, 0.025, 0.3); // 25 gross, 7.5 tax, 17.5 net
    expect(d).toEqual({ gross: 25, tax: 7.5, net: 17.5 });
  });
  it('rounds a fractional-cent result', () => {
    const d = calculateDividend(333.33, 0.025, 0.3);
    expect(d.gross).toBeCloseTo(8.33, 2);
    expect(Math.round((d.tax + d.net) * 100) / 100).toBe(d.gross);
  });
});

describe('computeVestedShares', () => {
  it('floors shares by money paid, capped at quantity', () => {
    expect(computeVestedShares(250, 100, 5)).toBe(2);
    expect(computeVestedShares(600, 100, 5)).toBe(5); // capped
  });
  it('returns 0 for non-positive price', () => {
    expect(computeVestedShares(250, 0, 5)).toBe(0);
  });
});

describe('computeTotalPaid', () => {
  it('sums mixed numeric/string amounts', () => {
    expect(computeTotalPaid([{ amount: '10.5' }, { amount: 4.5 }])).toBe(15);
  });
});

describe('apportionWithholdingTax (period-level rounding)', () => {
  it('sum of per-payout tax equals the rounded period total', () => {
    const grosses = [33.33, 33.33, 33.34]; // €100 total
    const rate = 0.3;
    const taxes = apportionWithholdingTax(grosses, rate);
    const periodTarget = Math.round(100 * rate * 100) / 100; // 30.00
    const sum = Math.round(taxes.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(sum).toBe(periodTarget);
    taxes.forEach((t) => expect(Number.isInteger(Math.round(t * 100))).toBe(true)); // whole cents
  });

  it('handles a single payout exactly', () => {
    expect(apportionWithholdingTax([50], 0.3)).toEqual([15]);
  });

  it('handles an empty list', () => {
    expect(apportionWithholdingTax([], 0.3)).toEqual([]);
  });

  it('every payout tax is a non-negative whole-cent value', () => {
    const taxes = apportionWithholdingTax([10.01, 20.02, 30.03, 5.55], 0.3);
    taxes.forEach((t) => {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(Math.round(t * 100)).toBeCloseTo(t * 100, 6);
    });
  });
});
