const DAY_MS = 86_400_000;

/** Processing target: a card is handled within 5 working days. */
export const PROCESSING_WORKING_DAYS = 5;

/**
 * Counts Monday-to-Friday calendar days after `from`, up to and including
 * `to`. Uses UTC calendar dates; public holidays are not excluded.
 */
export function workingDaysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  let count = 0;
  for (let day = start + DAY_MS; day <= end; day += DAY_MS) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

export function isOverdue(waitingSince: Date, now: Date): boolean {
  return workingDaysBetween(waitingSince, now) > PROCESSING_WORKING_DAYS;
}
