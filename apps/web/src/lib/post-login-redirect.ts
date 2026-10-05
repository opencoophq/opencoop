/**
 * Remembers where a logged-out visitor wanted to go, so the dashboard can send
 * them there after any login (password, passkey, magic link, OAuth). Stored in
 * localStorage because a magic link opens in a new tab.
 */
const KEY = 'opencoop-post-login-redirect';
const TTL_MS = 30 * 60 * 1000;
// Only dashboard paths, with an optional locale prefix. No hosts, no "//", no "/\".
const SAFE_PATH = /^\/(?:(?:nl|en|fr|de)\/)?dashboard(?:\/[A-Za-z0-9_-]+)*\/?$/;

export function isSafeRedirectPath(path: string | null | undefined): path is string {
  if (typeof path !== 'string') return false;
  // Belt-and-suspenders: SAFE_PATH is anchored and its character class already
  // rejects "//" and "/\" on its own, but reject them explicitly first too, so
  // the open-redirect guard does not depend solely on one regex being correct.
  if (path.length < 2 || path[0] !== '/' || path[1] === '/' || path[1] === '\\') return false;
  return SAFE_PATH.test(path);
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
