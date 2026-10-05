import { consumePostLoginRedirect, isSafeRedirectPath, rememberPostLoginRedirect } from './post-login-redirect';

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
