import {
  chargeCardEntryPath,
  chargeCardLoginPath,
  chargeCardRegisterPath,
  chargeCardRequestPath,
  isChargeCardEntryPath,
  pickCoopShareholderStatus,
  resolveChargeCardEntry,
} from './charge-card-entry';
import { isSafeRedirectPath } from './post-login-redirect';

describe('charge card entry paths', () => {
  it('builds a per-coop entry the redirect allowlist accepts', () => {
    const path = chargeCardEntryPath('nl', 'bronsgroen');
    expect(path).toBe('/nl/bronsgroen/laadpas');
    expect(isChargeCardEntryPath(path)).toBe(true);
    expect(isSafeRedirectPath(path)).toBe(true);
  });

  it.each(['nl', 'en', 'fr', 'de'] as const)('accepts locale %s', (locale) => {
    expect(isChargeCardEntryPath(`/${locale}/demo/laadpas`)).toBe(true);
    expect(isSafeRedirectPath(`/${locale}/my-coop/laadpas/`)).toBe(true);
  });

  it('puts the entry path in the login and registration links', () => {
    expect(chargeCardLoginPath('nl', 'bronsgroen')).toBe(
      '/nl/bronsgroen/login?redirect=%2Fnl%2Fbronsgroen%2Flaadpas',
    );
    expect(chargeCardRegisterPath('fr', 'bronsgroen')).toBe(
      '/fr/bronsgroen/register?redirect=%2Ffr%2Fbronsgroen%2Flaadpas',
    );
    expect(isSafeRedirectPath(decodeURIComponent('%2Fnl%2Fbronsgroen%2Flaadpas'))).toBe(true);
  });

  it('refuses to build a path from a slug or locale that could leave the site', () => {
    expect(chargeCardEntryPath('nl', 'bronsgroen.be')).toBeNull();
    expect(chargeCardEntryPath('nl', '../admin')).toBeNull();
    expect(chargeCardEntryPath('nl', 'a/b')).toBeNull();
    expect(chargeCardEntryPath('NL', 'bronsgroen')).toBeNull();
    expect(chargeCardLoginPath('nl', '//evil.com')).toBeNull();
    expect(chargeCardRequestPath('javascript')).toBeNull();
  });

  it('rejects open redirects and paths that only look like the entry', () => {
    expect(isChargeCardEntryPath('/nl/bronsgroen/laadpas')).toBe(true);
    expect(isSafeRedirectPath('//evil.com/nl/bronsgroen/laadpas')).toBe(false);
    expect(isSafeRedirectPath('https://evil.com/nl/bronsgroen/laadpas')).toBe(false);
    expect(isSafeRedirectPath('/nl/bronsgroen/laadpas/extra')).toBe(false);
    expect(isSafeRedirectPath('/nl/bronsgroen/laadpas?next=https://evil.com')).toBe(false);
    expect(isSafeRedirectPath('/nl/bronsgroen/login')).toBe(false);
    expect(isSafeRedirectPath('/NL/bronsgroen/laadpas')).toBe(false);
    expect(isSafeRedirectPath('/nl/Bronsgroen/laadpas')).toBe(false);
    expect(isChargeCardEntryPath(null)).toBe(false);
  });

  it('points an active shareholder at the request dialog', () => {
    expect(chargeCardRequestPath('en')).toBe('/en/dashboard/charge-cards?request=1');
  });
});

describe('pickCoopShareholderStatus', () => {
  it('ignores other coops and prefers an active record', () => {
    expect(
      pickCoopShareholderStatus(
        [
          { status: 'INACTIVE', coop: { slug: 'bronsgroen' } },
          { status: 'ACTIVE', coop: { slug: 'other' } },
          { status: 'PENDING', coop: { slug: 'bronsgroen' } },
          { status: 'ACTIVE', coop: { slug: 'bronsgroen' } },
        ],
        'bronsgroen',
      ),
    ).toBe('ACTIVE');
  });

  it('returns null when the user has no record in this coop', () => {
    expect(pickCoopShareholderStatus([{ status: 'ACTIVE', coop: { slug: 'demo' } }], 'bronsgroen')).toBeNull();
    expect(pickCoopShareholderStatus([], 'bronsgroen')).toBeNull();
  });
});

describe('resolveChargeCardEntry', () => {
  it('asks a logged-out visitor before sending them anywhere', () => {
    expect(resolveChargeCardEntry({ enabled: true, loggedIn: false, shareholderStatus: null })).toBe('ask');
  });

  it('sends an active shareholder straight to the request', () => {
    expect(resolveChargeCardEntry({ enabled: true, loggedIn: true, shareholderStatus: 'ACTIVE' })).toBe('request');
  });

  it('keeps a pending member on a payment explanation instead of the request', () => {
    expect(resolveChargeCardEntry({ enabled: true, loggedIn: true, shareholderStatus: 'PENDING' })).toBe(
      'pending-payment',
    );
  });

  it('sends an inactive member back through share purchase', () => {
    expect(resolveChargeCardEntry({ enabled: true, loggedIn: true, shareholderStatus: 'INACTIVE' })).toBe('inactive');
  });

  it('sends a logged-in non-member into registration', () => {
    expect(resolveChargeCardEntry({ enabled: true, loggedIn: true, shareholderStatus: null })).toBe(
      'become-shareholder',
    );
  });

  it('stops when the coop has not enabled charge cards', () => {
    expect(resolveChargeCardEntry({ enabled: true, loggedIn: false, shareholderStatus: null })).not.toBe(
      'unavailable',
    );
    expect(resolveChargeCardEntry({ enabled: false, loggedIn: true, shareholderStatus: 'ACTIVE' })).toBe(
      'unavailable',
    );
  });
});
