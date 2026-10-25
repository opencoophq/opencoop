/**
 * Login sessions are the refresh-token rows. The access JWT is only a 15-minute
 * cache of that session. Rotation reissues the refresh token; it does not extend
 * the session past the hard maximum.
 */
export const SESSION_MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** Reissue the session token once it is at least this old. */
export const SESSION_ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Opt-in so a deploy does not invalidate tokens held by a browser that cannot
 * store the replacement. The previous web build does not send this header.
 * Keep the name in sync with apps/web/src/lib/api.ts.
 */
export const SESSION_ROTATION_REQUEST_HEADER = 'x-session-rotation';

/** Replacement refresh token. Browser clients read the lower-cased name. */
export const SESSION_ROTATION_RESPONSE_HEADER = 'x-session-token';

export function sessionRotationDue(issuedAt: Date, now: Date): boolean {
  return now.getTime() - issuedAt.getTime() >= SESSION_ROTATION_INTERVAL_MS;
}

/** Access-token claim `sst` is Unix seconds. Missing or young claims skip the DB. */
export function sessionRotationDueFromClaim(issuedAtSeconds: number, now: Date): boolean {
  return now.getTime() - issuedAtSeconds * 1000 >= SESSION_ROTATION_INTERVAL_MS;
}

export function sessionExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + SESSION_MAX_LIFETIME_MS);
}
