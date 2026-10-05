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
  // Reject anything that isn't a single leading slash followed by a normal
  // path character: "//evil.com" and "/\evil.com" are both browser-parsed as
  // protocol-relative or backslash-normalized absolute URLs, not same-origin
  // paths, even though the regex below would otherwise accept their prefix.
  if (path.length < 2 || path[0] !== '/' || path[1] === '/' || path[1] === '\\') return false;
  return SAFE_PATH.test(path);
}

export function rememberPostLoginRedirect(path: string | null | undefined): void {
  if (!isSafeRedirectPath(path)) return;
  localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
}

export function consumePostLoginRedirect(): string | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  localStorage.removeItem(KEY);
  try {
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof at === 'number' && Date.now() - at <= TTL_MS && isSafeRedirectPath(path as string)) {
      return path as string;
    }
  } catch {
    /* corrupt entry: ignore it, it is already removed */
  }
  return null;
}
