import { ForbiddenException } from '@nestjs/common';

/** How long a lapsed coop keeps accepting public signups. Single source for the window. */
export const LAPSED_SIGNUP_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

export const PUBLIC_SIGNUP_CLOSED_CODE = 'SIGNUP_CLOSED';

export const PUBLIC_SIGNUP_CLOSED_MESSAGE =
  'This cooperative is not accepting new registrations right now. Please contact the cooperative if you think this is a mistake.';

/**
 * Statuses that mean the paid subscription is no longer in good standing.
 * `UNPAID` includes Stripe statuses we do not recognise (fail closed).
 * `INCOMPLETE` includes `incomplete_expired`. `PAST_DUE` includes `paused`.
 * `TRIALING` and `ACTIVE` are not lapsed.
 */
const LAPSED_SUBSCRIPTION_STATUSES = new Set(['PAST_DUE', 'CANCELED', 'UNPAID', 'INCOMPLETE']);

export function isLapsedSubscriptionStatus(status: string | null | undefined): boolean {
  return !!status && LAPSED_SUBSCRIPTION_STATUSES.has(status);
}

/**
 * Public shareholder signup only. Admin read-only mode is `computeIsReadOnly`
 * and does not use this window.
 *
 * A paid coop with a lapsed subscription and no `lapsedAt` is closed. Missing
 * the timestamp is treated as already past the grace period (fail closed).
 */
export function publicSignupClosed(input: {
  plan: string | null | undefined;
  subscriptionStatus: string | null | undefined;
  lapsedAt: Date | null | undefined;
  now: Date;
}): boolean {
  if (!input.plan || input.plan === 'FREE') return false;
  if (!isLapsedSubscriptionStatus(input.subscriptionStatus)) return false;
  if (!input.lapsedAt) return true;
  return input.now.getTime() >= input.lapsedAt.getTime() + LAPSED_SIGNUP_GRACE_MS;
}

/** Keep the original lapse instant when an already-lapsed subscription changes status. Clear it when the subscription recovers. */
export function nextLapsedAt(
  nextStatus: string,
  currentLapsedAt: Date | null | undefined,
  now: Date,
): Date | null {
  if (!isLapsedSubscriptionStatus(nextStatus)) return null;
  return currentLapsedAt ?? now;
}

export class PublicSignupClosedException extends ForbiddenException {
  constructor() {
    super({
      statusCode: 403,
      error: 'Forbidden',
      message: PUBLIC_SIGNUP_CLOSED_MESSAGE,
      code: PUBLIC_SIGNUP_CLOSED_CODE,
    });
  }
}

export async function refusePublicSignupIfLapsed(
  prisma: {
    subscription: {
      findUnique(args: {
        where: { coopId: string };
        select: { status: true; lapsedAt: true };
      }): Promise<{ status: string; lapsedAt: Date | null } | null>;
    };
  },
  coop: { id: string; plan?: string | null },
  now = new Date(),
): Promise<void> {
  if (!coop.plan || coop.plan === 'FREE') return;
  const subscription = await prisma.subscription.findUnique({
    where: { coopId: coop.id },
    select: { status: true, lapsedAt: true },
  });
  if (
    publicSignupClosed({
      plan: coop.plan,
      subscriptionStatus: subscription?.status ?? null,
      lapsedAt: subscription?.lapsedAt ?? null,
      now,
    })
  ) {
    throw new PublicSignupClosedException();
  }
}
