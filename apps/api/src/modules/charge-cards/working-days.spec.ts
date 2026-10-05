import { isOverdue, workingDaysBetween } from './working-days';

const d = (iso: string) => new Date(iso);

describe('workingDaysBetween', () => {
  it('is 0 on the same day', () => {
    expect(workingDaysBetween(d('2026-10-05T08:00:00Z'), d('2026-10-05T17:00:00Z'))).toBe(0);
  });

  it('counts Monday to next Monday as 5', () => {
    expect(workingDaysBetween(d('2026-10-05T08:00:00Z'), d('2026-10-12T08:00:00Z'))).toBe(5);
  });

  it('counts Friday to Monday as 1', () => {
    expect(workingDaysBetween(d('2026-10-09T16:00:00Z'), d('2026-10-12T09:00:00Z'))).toBe(1);
  });

  it('counts Saturday to Monday as 1', () => {
    expect(workingDaysBetween(d('2026-10-10T10:00:00Z'), d('2026-10-12T09:00:00Z'))).toBe(1);
  });

  it('counts Friday to Sunday as 0', () => {
    expect(workingDaysBetween(d('2026-10-09T10:00:00Z'), d('2026-10-11T10:00:00Z'))).toBe(0);
  });

  it('ignores the time of day', () => {
    expect(workingDaysBetween(d('2026-10-05T23:59:00Z'), d('2026-10-06T00:01:00Z'))).toBe(1);
  });

  it('is 0 when the end lies before the start', () => {
    expect(workingDaysBetween(d('2026-10-12T08:00:00Z'), d('2026-10-05T08:00:00Z'))).toBe(0);
  });
});

describe('isOverdue', () => {
  it('is false at exactly 5 working days', () => {
    expect(isOverdue(d('2026-10-05T08:00:00Z'), d('2026-10-12T08:00:00Z'))).toBe(false);
  });

  it('is true from the 6th working day', () => {
    expect(isOverdue(d('2026-10-05T08:00:00Z'), d('2026-10-13T08:00:00Z'))).toBe(true);
  });
});
