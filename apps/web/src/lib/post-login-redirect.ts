/**
 * Remembers where a logged-out visitor wanted to go, so the dashboard can send
 * them there after any login (password, passkey, magic link, OAuth). Stored in
 * localStorage because a magic link opens in a new tab.
 */
const KEY = 'opencoop-post-login-redirect';
const TTL_MS = 30 * 60 * 1000;
// Only dashboard paths, with an optional locale prefix. No hosts, no "//", no "/\".
const DASHBOARD_PATH = /^\/(?:(?:nl|en|fr|de)\/)?dashboard(?:\/[A-Za-z0-9_-]+)*\/?$/;
const COOP_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The charge-card request form is the one dashboard URL that may carry a query,
 * and only these two keys: which coop the visitor came in for, and whether to
 * open the request dialog. A query on any other page, or any other key, is
 * rejected so `?redirect=` cannot grow into an open redirect.
 */
function isAllowedChargeCardQuery(search: string): boolean {
  if (!search || search.includes('#') || search.includes('?')) return false;
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  if (keys.length === 0 || keys.some((key) => key !== 'coop' && key !== 'request')) return false;
  if (params.getAll('coop').length > 1 || params.getAll('request').length > 1) return false;
  const request = params.get('request');
  const coop = params.get('coop');
  if (request !== null && request !== '1') return false;
  if (coop !== null && !COOP_SLUG.test(coop)) return false;
  return request !== null || coop !== null;
}

export function isSafeRedirectPath(path: string | null | undefined): path is string {
  if (typeof path !== 'string') return false;
  // Belt-and-suspenders: DASHBOARD_PATH is anchored and its character class
  // already rejects "//" and "/\" on its own, but reject them explicitly first
  // too, so the open-redirect guard does not depend solely on one regex.
  if (path.length < 2 || path[0] !== '/' || path[1] === '/' || path[1] === '\\') return false;
  if (path.includes('\\') || path.includes('//') || path.includes('#')) return false;
  const queryAt = path.indexOf('?');
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const search = queryAt === -1 ? '' : path.slice(queryAt + 1);
  if (!DASHBOARD_PATH.test(pathname)) return false;
  if (!search) return true;
  return /\/dashboard\/charge-cards\/?$/.test(pathname) && isAllowedChargeCardQuery(search);
}

export function rememberPostLoginRedirect(path: string | null | undefined): void {
  if (!isSafeRedirectPath(path)) return;
  localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
}

function readPending(): { path: string; at: number } | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof at === 'number' && Date.now() - at <= TTL_MS && isSafeRedirectPath(path as string)) {
      return { path: path as string, at };
    }
  } catch {
    /* corrupt entry: treat as absent */
  }
  return null;
}

/**
 * True if a not-yet-consumed, not-expired redirect is already queued. Does
 * not consume it. Used before overwriting the stored path with a fallback,
 * so a more specific deep link already captured earlier in the same login
 * attempt (e.g. by the branded login page's own `?redirect=`) is not
 * clobbered by a later, less specific one (e.g. the generic `/dashboard` a
 * client-side redirect landed on before the session turned out to be dead).
 */
export function hasPendingPostLoginRedirect(): boolean {
  return readPending() !== null;
}

export function consumePostLoginRedirect(): string | null {
  const pending = readPending();
  localStorage.removeItem(KEY);
  return pending?.path ?? null;
}
