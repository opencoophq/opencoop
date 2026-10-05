import {
  consumePostLoginRedirect,
  hasPendingPostLoginRedirect,
  isSafeRedirectPath,
  rememberPostLoginRedirect,
} from './post-login-redirect';

describe('isSafeRedirectPath', () => {
  it('accepts a bare dashboard path', () => {
    expect(isSafeRedirectPath('/dashboard')).toBe(true);
    expect(isSafeRedirectPath('/dashboard/charge-cards')).toBe(true);
  });

  it('accepts a locale-prefixed dashboard path', () => {
    expect(isSafeRedirectPath('/nl/dashboard/charge-cards')).toBe(true);
    expect(isSafeRedirectPath('/en/dashboard')).toBe(true);
    expect(isSafeRedirectPath('/fr/dashboard/settings')).toBe(true);
    expect(isSafeRedirectPath('/de/dashboard/')).toBe(true);
  });

  it('rejects protocol-relative URLs ("//")', () => {
    expect(isSafeRedirectPath('//evil.com')).toBe(false);
    expect(isSafeRedirectPath('//evil.com/dashboard')).toBe(false);
  });

  it('rejects backslash-prefixed paths ("/\\\\")', () => {
    expect(isSafeRedirectPath('/\\evil.com')).toBe(false);
    expect(isSafeRedirectPath('/\\evil.com/dashboard')).toBe(false);
  });

  it('rejects absolute URLs', () => {
    expect(isSafeRedirectPath('https://evil.com/dashboard')).toBe(false);
    expect(isSafeRedirectPath('http://evil.com')).toBe(false);
  });

  it('rejects javascript: URLs', () => {
    expect(isSafeRedirectPath('javascript:alert(1)')).toBe(false);
  });

  it('rejects paths outside the dashboard', () => {
    expect(isSafeRedirectPath('/login')).toBe(false);
    expect(isSafeRedirectPath('/')).toBe(false);
    expect(isSafeRedirectPath('')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isSafeRedirectPath(null)).toBe(false);
    expect(isSafeRedirectPath(undefined)).toBe(false);
  });
});

describe('rememberPostLoginRedirect / consumePostLoginRedirect', () => {
  const KEY = 'opencoop-post-login-redirect';

  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a safe path', () => {
    rememberPostLoginRedirect('/nl/dashboard/charge-cards');
    expect(consumePostLoginRedirect()).toBe('/nl/dashboard/charge-cards');
    // Consuming removes the stored entry.
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('never stores an unsafe path', () => {
    rememberPostLoginRedirect('//evil.com/dashboard');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(consumePostLoginRedirect()).toBeNull();
  });

  it('ignores null/undefined without throwing', () => {
    rememberPostLoginRedirect(null);
    rememberPostLoginRedirect(undefined);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('expires an entry older than the TTL', () => {
    localStorage.setItem(KEY, JSON.stringify({ path: '/nl/dashboard', at: Date.now() - 31 * 60 * 1000 }));
    expect(consumePostLoginRedirect()).toBeNull();
  });

  it('ignores a corrupt entry', () => {
    localStorage.setItem(KEY, 'not json');
    expect(consumePostLoginRedirect()).toBeNull();
  });

  it('rejects a stored entry whose path became unsafe', () => {
    localStorage.setItem(KEY, JSON.stringify({ path: '//evil.com', at: Date.now() }));
    expect(consumePostLoginRedirect()).toBeNull();
  });
});

describe('hasPendingPostLoginRedirect', () => {
  const KEY = 'opencoop-post-login-redirect';

  beforeEach(() => {
    localStorage.clear();
  });

  it('is false when nothing is queued', () => {
    expect(hasPendingPostLoginRedirect()).toBe(false);
  });

  it('is true for a fresh, valid entry, and does not consume it', () => {
    rememberPostLoginRedirect('/nl/dashboard/charge-cards');

    expect(hasPendingPostLoginRedirect()).toBe(true);
    // Peeking must not remove the entry: a later real consume should still see it.
    expect(hasPendingPostLoginRedirect()).toBe(true);
    expect(consumePostLoginRedirect()).toBe('/nl/dashboard/charge-cards');
  });

  it('is false for an expired entry', () => {
    localStorage.setItem(KEY, JSON.stringify({ path: '/nl/dashboard', at: Date.now() - 31 * 60 * 1000 }));
    expect(hasPendingPostLoginRedirect()).toBe(false);
  });

  it('is false for a corrupt entry', () => {
    localStorage.setItem(KEY, 'not json');
    expect(hasPendingPostLoginRedirect()).toBe(false);
  });

  it('lets a more specific deep link already queued survive a later, less specific remember call', () => {
    // This is the expired-session scenario: a branded login page stores the
    // real deep link, then a stale-token redirect elsewhere would otherwise
    // overwrite it with a generic page. The caller (api.ts) must check this
    // before calling rememberPostLoginRedirect again.
    rememberPostLoginRedirect('/nl/dashboard/charge-cards');

    if (!hasPendingPostLoginRedirect()) {
      rememberPostLoginRedirect('/nl/dashboard');
    }

    expect(consumePostLoginRedirect()).toBe('/nl/dashboard/charge-cards');
  });
});
