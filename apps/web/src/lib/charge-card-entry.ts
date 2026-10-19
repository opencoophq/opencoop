/**
 * Public charge-card entry (`/{locale}/{coopSlug}/laadpas`).
 *
 * The page is coop-scoped and anonymous. From there a visitor either logs in
 * and lands on the request form, or buys a share first and comes back. Paths
 * that travel through `?redirect=` / `?returnTo=` are allowlisted here so a
 * crafted link cannot leave this site.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type Membership = 'ACTIVE' | 'PENDING' | 'INACTIVE' | 'NONE';

export type EntryView =
  | 'redirect-request'
  | 'ask'
  | 'pending'
  | 'inactive'
  | 'join'
  | 'after-registration';

export interface ChargeCardShareholderRef {
  id: string;
  status?: string | null;
  type?: string | null;
  coop?: { slug?: string | null } | null;
}

export function isCoopSlug(value: string | null | undefined): value is string {
  return typeof value === 'string' && SLUG.test(value);
}

export function chargeCardEntryPath(locale: string, coopSlug: string, afterRegistration = false): string {
  const path = `/${locale}/${coopSlug}/laadpas`;
  return afterRegistration ? `${path}?after=registration` : path;
}

/** Dashboard request form for one coop. `request=1` opens the dialog. */
export function chargeCardRequestPath(locale: string, coopSlug: string): string {
  const params = new URLSearchParams({ coop: coopSlug, request: '1' });
  return `/${locale}/dashboard/charge-cards?${params.toString()}`;
}

/**
 * Accept only this coop's laadpas page, with an optional `after=registration`
 * marker. Anything else (other hosts, other coops, extra query keys) is dropped.
 */
export function chargeCardReturnHref(returnTo: string | null | undefined, coopSlug: string): string | null {
  if (!returnTo || !isCoopSlug(coopSlug)) return null;
  if (returnTo.includes('\\') || returnTo.includes('//')) return null;
  let url: URL;
  try {
    url = new URL(returnTo, 'https://opencoop.local');
  } catch {
    return null;
  }
  if (url.origin !== 'https://opencoop.local' || url.username || url.password || url.hash) return null;
  const match = url.pathname.match(/^\/(nl|en|fr|de)\/([^/]+)\/laadpas\/?$/);
  if (!match || match[1] === undefined || match[2] !== coopSlug) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length === 0) return `/${match[1]}/${coopSlug}/laadpas`;
  if (keys.length === 1 && url.searchParams.get('after') === 'registration') {
    return `/${match[1]}/${coopSlug}/laadpas?after=registration`;
  }
  return null;
}

export function membershipForCoop(
  shareholders: Array<{ status?: string | null; coop?: { slug?: string | null } | null }>,
  coopSlug: string,
): Membership {
  const mine = shareholders.filter((s) => s.coop?.slug === coopSlug);
  if (mine.some((s) => s.status === 'ACTIVE')) return 'ACTIVE';
  if (mine.some((s) => s.status === 'PENDING')) return 'PENDING';
  if (mine.length > 0) return 'INACTIVE';
  return 'NONE';
}

/**
 * Which shareholder the dashboard charge-card page should load.
 * Without a coop (the in-app nav) the first record wins, matching the other
 * dashboard pages. With a coop, an active membership wins over a pending one,
 * and an individual record wins over a company or a minor in the same coop.
 */
export function pickChargeCardShareholder<T extends ChargeCardShareholderRef>(
  shareholders: T[],
  coopSlug: string | null,
): T | null {
  const pool = coopSlug ? shareholders.filter((s) => s.coop?.slug === coopSlug) : shareholders;
  if (pool.length === 0) return null;
  if (!coopSlug) return pool[0];
  const prefer = (rows: T[]) => rows.find((s) => s.type === 'INDIVIDUAL') ?? rows[0];
  const active = pool.filter((s) => s.status === 'ACTIVE');
  if (active.length > 0) return prefer(active);
  const pending = pool.filter((s) => s.status === 'PENDING');
  if (pending.length > 0) return prefer(pending);
  return prefer(pool);
}

export function entryView(input: {
  loggedIn: boolean;
  membership: Membership;
  afterRegistration: boolean;
}): EntryView {
  if (input.loggedIn && input.membership === 'ACTIVE') return 'redirect-request';
  if (input.loggedIn && input.membership === 'PENDING') return 'pending';
  if (input.loggedIn && input.membership === 'INACTIVE') return 'inactive';
  if (input.loggedIn && input.membership === 'NONE') return 'join';
  if (input.afterRegistration) return 'after-registration';
  return 'ask';
}
