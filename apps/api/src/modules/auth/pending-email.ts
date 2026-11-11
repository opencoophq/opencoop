/**
 * A requested login email change lives in `pendingEmail` and shares the
 * emailVerifyToken/emailVerifyExpires pair with it. Past that expiry the
 * change is dead: treat it as absent.
 */
export function activePendingEmail(
  user: { pendingEmail?: string | null; emailVerifyExpires?: Date | null },
  now = new Date(),
): string | null {
  if (!user.pendingEmail || !user.emailVerifyExpires) return null;
  return user.emailVerifyExpires > now ? user.pendingEmail : null;
}

/** Prisma data that drops a pending change together with its token. */
export const CLEAR_PENDING_EMAIL = {
  pendingEmail: null,
  emailVerifyToken: null,
  emailVerifyExpires: null,
} as const;
