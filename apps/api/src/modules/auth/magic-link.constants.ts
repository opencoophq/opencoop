/** Shared lifetime of the link and the one-time code. */
export const MAGIC_LINK_TTL_MS = 10 * 60 * 1000;

/** Wrong code guesses before the code locks. The link is not locked by this. */
export const MAGIC_LINK_MAX_CODE_ATTEMPTS = 5;

/**
 * Per-email request cap. Counts unused tokens so a mailbox cannot be flooded.
 * The per-IP cap is the `@Throttle` on `POST /auth/magic-link/request`
 * (ThrottlerGuard keys off `req.ip`).
 */
export const MAGIC_LINK_EMAIL_LIMIT = 3;
export const MAGIC_LINK_EMAIL_WINDOW_MS = 15 * 60 * 1000;

/** Per-IP cap for `POST /auth/magic-link/request`, passed to `@Throttle`. */
export const MAGIC_LINK_IP_LIMIT = 3;
export const MAGIC_LINK_IP_TTL_MS = 60_000;

export const MAGIC_LINK_SENT_MESSAGE = 'If an account exists, a login link has been sent';

export const MAGIC_LINK_INVALID = 'Invalid login link';
export const MAGIC_LINK_USED = 'This login link has already been used';
export const MAGIC_LINK_EXPIRED = 'This login link has expired';

export const MAGIC_LINK_CODE_INVALID = 'Invalid code';
export const MAGIC_LINK_CODE_EXPIRED = 'This code has expired';
export const MAGIC_LINK_CODE_LOCKED = 'Too many attempts. Request a new login code.';
