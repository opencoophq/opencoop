/**
 * Public charge-card entry (`/{locale}/{coopSlug}/laadpas`).
 *
 * The path is an allowlisted post-login / post-registration return target.
 * Slugs follow the coop slug rule (lowercase, digits, hyphens, one segment)
 * so a `?redirect=` value cannot escape to another host.
 */

const LOCALES = ['nl', 'en', 'fr', 'de'] as const;
export type ChargeCardLocale = (typeof LOCALES)[number];

const LOCALE = /^(?:nl|en|fr|de)$/;
const SLUG = /^[a-z0-9-]{1,50}$/;
const ENTRY_PATH = /^\/(?:nl|en|fr|de)\/[a-z0-9-]{1,50}\/laadpas\/?$/;

export type ShareholderStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE';

export type ChargeCardEntryKind =
  | 'unavailable'
  | 'ask'
  | 'request'
  | 'pending-payment'
  | 'inactive'
  | 'become-shareholder';

const STATUS_RANK: Record<ShareholderStatus, number> = {
  ACTIVE: 0,
  PENDING: 1,
  INACTIVE: 2,
};

export function isChargeCardLocale(locale: string): locale is ChargeCardLocale {
  return LOCALE.test(locale);
}

export function isCoopSlug(slug: string): boolean {
  return SLUG.test(slug);
}

/** True for the public entry only. No query, no extra segments, no other hosts. */
export function isChargeCardEntryPath(path: string | null | undefined): path is string {
  return typeof path === 'string' && ENTRY_PATH.test(path);
}

export function chargeCardEntryPath(locale: string, coopSlug: string): string | null {
  if (!isChargeCardLocale(locale) || !isCoopSlug(coopSlug)) return null;
  return `/${locale}/${coopSlug}/laadpas`;
}

export function chargeCardLoginPath(locale: string, coopSlug: string): string | null {
  const entry = chargeCardEntryPath(locale, coopSlug);
  if (!entry) return null;
  return `/${locale}/${coopSlug}/login?redirect=${encodeURIComponent(entry)}`;
}

export function chargeCardRegisterPath(locale: string, coopSlug: string): string | null {
  const entry = chargeCardEntryPath(locale, coopSlug);
  if (!entry) return null;
  return `/${locale}/${coopSlug}/register?redirect=${encodeURIComponent(entry)}`;
}

/** Where an active shareholder lands: the existing request dialog. */
export function chargeCardRequestPath(locale: string): string | null {
  if (!isChargeCardLocale(locale)) return null;
  return `/${locale}/dashboard/charge-cards?request=1`;
}

export function isShareholderStatus(status: string): status is ShareholderStatus {
  return status === 'PENDING' || status === 'ACTIVE' || status === 'INACTIVE';
}

/**
 * A user can hold more than one record in the same coop (themselves and a
 * company). Prefer the one that can actually request a card.
 */
export function pickCoopShareholderStatus(
  shareholders: Array<{ status?: string | null; coop?: { slug?: string | null } | null }>,
  coopSlug: string,
): ShareholderStatus | null {
  const statuses = shareholders
    .filter((shareholder) => shareholder.coop?.slug === coopSlug)
    .map((shareholder) => shareholder.status)
    .filter((status): status is ShareholderStatus => typeof status === 'string' && isShareholderStatus(status));
  statuses.sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b]);
  return statuses[0] ?? null;
}

/**
 * What the public entry should do.
 *
 * A request stays blocked until the shareholder is ACTIVE: a registration
 * is PENDING until the share payment is matched. Sending them back here
 * with a payment explanation is the next step; the API still refuses the
 * request before that.
 */
export function resolveChargeCardEntry(input: {
  enabled: boolean;
  loggedIn: boolean;
  shareholderStatus: ShareholderStatus | null;
}): ChargeCardEntryKind {
  if (!input.enabled) return 'unavailable';
  if (!input.loggedIn) return 'ask';
  if (input.shareholderStatus === 'ACTIVE') return 'request';
  if (input.shareholderStatus === 'PENDING') return 'pending-payment';
  if (input.shareholderStatus === 'INACTIVE') return 'inactive';
  return 'become-shareholder';
}
