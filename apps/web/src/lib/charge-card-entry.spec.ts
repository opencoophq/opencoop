import { isSafeRedirectPath } from './post-login-redirect';
import {
  chargeCardEntryPath,
  chargeCardRequestPath,
  chargeCardReturnHref,
  entryView,
  membershipForCoop,
  pickChargeCardShareholder,
} from './charge-card-entry';

const sh = (
  id: string,
  slug: string,
  status: string,
  type = 'INDIVIDUAL',
) => ({ id, status, type, coop: { slug } });

describe('charge card paths', () => {
  it('builds the public entry and the request form for any coop and locale', () => {
    expect(chargeCardEntryPath('nl', 'bronsgroen')).toBe('/nl/bronsgroen/laadpas');
    expect(chargeCardEntryPath('fr', 'bronsgroen', true)).toBe('/fr/bronsgroen/laadpas?after=registration');
    expect(chargeCardRequestPath('de', 'demo')).toBe('/de/dashboard/charge-cards?coop=demo&request=1');
  });

  it('lets the request form through the post-login redirect allowlist', () => {
    expect(isSafeRedirectPath(chargeCardRequestPath('nl', 'bronsgroen'))).toBe(true);
    expect(isSafeRedirectPath(chargeCardRequestPath('en', 'demo-coop'))).toBe(true);
    expect(isSafeRedirectPath('/dashboard/charge-cards?request=1')).toBe(true);
    expect(isSafeRedirectPath('/nl/dashboard/charge-cards?request=1&coop=bronsgroen')).toBe(true);
  });

  it('rejects a request path that smuggles another destination', () => {
    expect(isSafeRedirectPath('/nl/dashboard/charge-cards?coop=bronsgroen&request=1&next=https://evil.com')).toBe(false);
    expect(isSafeRedirectPath('/nl/dashboard/charge-cards?coop=../admin&request=1')).toBe(false);
    expect(isSafeRedirectPath('/nl/dashboard/settings?request=1')).toBe(false);
    expect(isSafeRedirectPath('/nl/bronsgroen/laadpas')).toBe(false);
    expect(isSafeRedirectPath('/nl/dashboard/charge-cards?request=2')).toBe(false);
  });
});

describe('chargeCardReturnHref', () => {
  it('keeps this coop\'s laadpas page, with or without the registration marker', () => {
    expect(chargeCardReturnHref('/nl/bronsgroen/laadpas', 'bronsgroen')).toBe('/nl/bronsgroen/laadpas');
    expect(chargeCardReturnHref('/fr/bronsgroen/laadpas?after=registration', 'bronsgroen')).toBe(
      '/fr/bronsgroen/laadpas?after=registration',
    );
  });

  it('drops other hosts, other coops and extra query keys', () => {
    expect(chargeCardReturnHref('https://evil.com/nl/bronsgroen/laadpas', 'bronsgroen')).toBeNull();
    expect(chargeCardReturnHref('//evil.com/nl/bronsgroen/laadpas', 'bronsgroen')).toBeNull();
    expect(chargeCardReturnHref('/nl/other/laadpas', 'bronsgroen')).toBeNull();
    expect(chargeCardReturnHref('/nl/bronsgroen/laadpas?after=registration&next=//evil.com', 'bronsgroen')).toBeNull();
    expect(chargeCardReturnHref('/nl/bronsgroen/register', 'bronsgroen')).toBeNull();
    expect(chargeCardReturnHref(null, 'bronsgroen')).toBeNull();
  });
});

describe('membership and shareholder pick', () => {
  const rows = [
    sh('minor', 'bronsgroen', 'PENDING', 'MINOR'),
    sh('company', 'bronsgroen', 'INACTIVE', 'COMPANY'),
    sh('self', 'bronsgroen', 'ACTIVE', 'INDIVIDUAL'),
    sh('other', 'demo', 'ACTIVE', 'INDIVIDUAL'),
  ];

  it('treats any active share in this coop as active, even when another coop is first', () => {
    expect(membershipForCoop([sh('other', 'demo', 'ACTIVE'), sh('self', 'bronsgroen', 'PENDING')], 'bronsgroen')).toBe(
      'PENDING',
    );
    expect(membershipForCoop(rows, 'bronsgroen')).toBe('ACTIVE');
    expect(membershipForCoop([sh('other', 'demo', 'ACTIVE')], 'bronsgroen')).toBe('NONE');
    expect(membershipForCoop([sh('gone', 'bronsgroen', 'INACTIVE')], 'bronsgroen')).toBe('INACTIVE');
  });

  it('picks the active individual of the requested coop', () => {
    expect(pickChargeCardShareholder(rows, 'bronsgroen')?.id).toBe('self');
  });

  it('prefers a pending membership over an inactive one when nobody is active', () => {
    const pending = [sh('company', 'bronsgroen', 'INACTIVE', 'COMPANY'), sh('self', 'bronsgroen', 'PENDING')];
    expect(pickChargeCardShareholder(pending, 'bronsgroen')?.id).toBe('self');
  });

  it('keeps the first shareholder when no coop is requested', () => {
    expect(pickChargeCardShareholder(rows, null)?.id).toBe('minor');
  });

  it('returns null when the visitor has no share in the requested coop', () => {
    expect(pickChargeCardShareholder(rows, 'unknown-coop')).toBeNull();
  });
});

describe('entryView', () => {
  it('sends an active member straight to the request form', () => {
    expect(entryView({ loggedIn: true, membership: 'ACTIVE', afterRegistration: false })).toBe('redirect-request');
    expect(entryView({ loggedIn: true, membership: 'ACTIVE', afterRegistration: true })).toBe('redirect-request');
  });

  it('explains a membership that is not active yet', () => {
    expect(entryView({ loggedIn: true, membership: 'PENDING', afterRegistration: true })).toBe('pending');
    expect(entryView({ loggedIn: true, membership: 'INACTIVE', afterRegistration: false })).toBe('inactive');
    expect(entryView({ loggedIn: true, membership: 'NONE', afterRegistration: false })).toBe('join');
  });

  it('asks anonymous visitors, and explains the wait right after registration', () => {
    expect(entryView({ loggedIn: false, membership: 'NONE', afterRegistration: false })).toBe('ask');
    expect(entryView({ loggedIn: false, membership: 'NONE', afterRegistration: true })).toBe('after-registration');
  });
});
