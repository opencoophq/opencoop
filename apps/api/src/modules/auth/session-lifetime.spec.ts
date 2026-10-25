import {
  SESSION_MAX_LIFETIME_MS,
  SESSION_ROTATION_INTERVAL_MS,
  sessionExpiresAt,
  sessionRotationDue,
  sessionRotationDueFromClaim,
} from './session-lifetime';

describe('session lifetime', () => {
  const issued = new Date('2026-01-01T00:00:00.000Z');

  it('keeps a 30-day hard maximum and a 24-hour rotation interval', () => {
    expect(SESSION_MAX_LIFETIME_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(SESSION_ROTATION_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
    expect(sessionExpiresAt(issued).toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('rotates at 24 hours and not one millisecond earlier', () => {
    expect(sessionRotationDue(issued, new Date(issued.getTime() + SESSION_ROTATION_INTERVAL_MS - 1))).toBe(false);
    expect(sessionRotationDue(issued, new Date(issued.getTime() + SESSION_ROTATION_INTERVAL_MS))).toBe(true);
  });

  it('treats the access-token claim with the same 24-hour boundary', () => {
    const issuedSeconds = Math.floor(issued.getTime() / 1000);
    expect(
      sessionRotationDueFromClaim(issuedSeconds, new Date(issuedSeconds * 1000 + SESSION_ROTATION_INTERVAL_MS - 1)),
    ).toBe(false);
    expect(
      sessionRotationDueFromClaim(issuedSeconds, new Date(issuedSeconds * 1000 + SESSION_ROTATION_INTERVAL_MS)),
    ).toBe(true);
  });
});
