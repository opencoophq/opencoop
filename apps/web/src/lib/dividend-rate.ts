/**
 * Share-class dividend overrides are stored as fractions (0.035 = 3.5%),
 * the same unit as a dividend period and the CSV importer. The admin field
 * is labeled "%", so the form converts at the edges.
 */
export function dividendPercentToFraction(percent: number): number {
  if (!Number.isFinite(percent)) return Number.NaN;
  return Math.round(percent * 1_000_000) / 100_000_000;
}

export function dividendFractionToPercentInput(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction === 0) return '';
  const percent = Math.round(fraction * 1_000_000) / 10_000;
  return String(percent);
}
