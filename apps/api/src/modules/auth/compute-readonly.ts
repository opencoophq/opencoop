/**
 * Determine whether a coop is in read-only mode based on its plan,
 * trial window, and subscription status. Pure function — extracted from
 * AuthService so both TokenService and AuthService.getProfile can share it.
 *
 * A paid-plan coop becomes read-only once it has no active subscription AND
 * its trial has lapsed. FREE-plan coops are never read-only.
 */
export function computeIsReadOnly(coop: {
  plan: string;
  trialEndsAt: Date | null;
  subscription: { status: string } | null;
}): boolean {
  if (coop.plan === 'FREE') return false;
  if (coop.subscription?.status === 'ACTIVE') return false;
  if (coop.trialEndsAt && coop.trialEndsAt > new Date()) return false;
  return true;
}
