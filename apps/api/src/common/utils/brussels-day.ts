/**
 * Calendar days in Europe/Brussels, the coop's legal time zone. A "day" is a
 * YYYY-MM-DD string; its Date form is always UTC midnight of that day.
 */
const BRUSSELS_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Brussels',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar day (YYYY-MM-DD) of an instant in Europe/Brussels. */
export function brusselsDay(date: Date): string {
  return BRUSSELS_DAY.format(date);
}

/**
 * Parse an ISO date or date-time to its Brussels calendar day. The returned date is
 * always UTC midnight of that day, so it sorts the same way as a date-only
 * ex-dividend date: 2026-03-09T23:30Z (10 March in Brussels) becomes 2026-03-10T00:00Z.
 */
export function parseDay(value: Date | string | undefined | null): { date: Date; day: string } | null {
  if (value === undefined || value === null || value === '') return null;
  let day: string;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    day = brusselsDay(value);
  } else if (typeof value !== 'string') {
    return null;
  } else if (DATE_ONLY.test(value)) {
    day = value;
  } else {
    const instant = new Date(value);
    if (isNaN(instant.getTime())) return null;
    day = brusselsDay(instant);
  }
  const date = new Date(`${day}T00:00:00.000Z`);
  // Reject roll-overs such as 2026-02-31.
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  return { date, day };
}
