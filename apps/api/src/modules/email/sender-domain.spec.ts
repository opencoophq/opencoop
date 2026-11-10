import {
  isAuthCriticalTemplate,
  normalizeDomain,
  normalizeEmail,
  resolvePlatformEnvelopes,
  type CoopSenderFields,
} from './sender-domain';

const coop = (overrides: Partial<CoopSenderFields> = {}): CoopSenderFields => ({
  name: 'Bronsgroen CV',
  coopEmail: 'info@bronsgroen.be',
  senderDomain: 'bronsgroen.be',
  senderFromAddress: 'noreply@bronsgroen.be',
  senderFromName: 'Bronsgroen',
  senderDomainStatus: 'verified',
  ...overrides,
});

describe('sender domain envelopes', () => {
  const platformFrom = 'OpenCoop <noreply@opencoop.be>';

  it('uses the coop address only when the domain is verified and the mailbox matches', () => {
    const envelopes = resolvePlatformEnvelopes({ platformFrom, coop: coop() });

    expect(envelopes.custom).toBe(true);
    expect(envelopes.selected).toEqual({
      from: 'Bronsgroen <noreply@bronsgroen.be>',
      fromAddress: 'noreply@bronsgroen.be',
      replyTo: 'info@bronsgroen.be',
    });
    expect(envelopes.platform).toEqual({
      from: 'Bronsgroen <noreply@opencoop.be>',
      fromAddress: 'noreply@opencoop.be',
      replyTo: 'info@bronsgroen.be',
    });
  });

  it.each(['pending', 'failed', null, ''])(
    'falls back to the platform address when status is %s',
    (status) => {
      const envelopes = resolvePlatformEnvelopes({
        platformFrom,
        senderName: 'Ignored when a from-name is stored',
        coop: coop({ senderDomainStatus: status }),
      });

      expect(envelopes.custom).toBe(false);
      expect(envelopes.selected.fromAddress).toBe('noreply@opencoop.be');
      expect(envelopes.selected.from).toBe('Bronsgroen <noreply@opencoop.be>');
    },
  );

  it('accepts a verified status with different casing', () => {
    const envelopes = resolvePlatformEnvelopes({
      platformFrom,
      coop: coop({ senderDomainStatus: 'Verified' }),
    });
    expect(envelopes.custom).toBe(true);
  });

  it('does not use a verified from-address on a different domain', () => {
    const envelopes = resolvePlatformEnvelopes({
      platformFrom,
      coop: coop({ senderFromAddress: 'noreply@other.be' }),
    });
    expect(envelopes.custom).toBe(false);
    expect(envelopes.selected.fromAddress).toBe('noreply@opencoop.be');
  });

  it('keeps the caller display name when the coop has no sender name', () => {
    const envelopes = resolvePlatformEnvelopes({
      platformFrom,
      senderName: 'Zonnecoöperatie',
      coop: coop({ senderFromName: null, senderDomainStatus: 'pending' }),
    });
    expect(envelopes.selected.from).toBe('Zonnecoöperatie <noreply@opencoop.be>');
  });

  it('strips header injection from the display name', () => {
    const envelopes = resolvePlatformEnvelopes({
      platformFrom,
      coop: coop({ senderFromName: 'Bronsgroen\r\nBcc: evil@example.com' }),
    });
    expect(envelopes.selected.from).toBe(
      'Bronsgroen Bcc: evil@example.com <noreply@bronsgroen.be>',
    );
    expect(envelopes.selected.from).not.toMatch(/[\r\n]/);
  });

  it('omits Reply-To when it is the same mailbox as From', () => {
    const envelopes = resolvePlatformEnvelopes({
      platformFrom,
      coop: coop({ coopEmail: 'noreply@bronsgroen.be' }),
    });
    expect(envelopes.selected.replyTo).toBeUndefined();
    expect(envelopes.platform.replyTo).toBe('noreply@bronsgroen.be');
  });

  it('does not send as the platform domain even if a row says it is verified', () => {
    const envelopes = resolvePlatformEnvelopes({
      platformFrom,
      coop: coop({
        senderDomain: 'opencoop.be',
        senderFromAddress: 'noreply@opencoop.be',
        senderDomainStatus: 'verified',
      }),
    });
    expect(envelopes.custom).toBe(false);
  });

  it('treats login codes, resets and verification as auth-critical', () => {
    expect(isAuthCriticalTemplate('magic-link')).toBe(true);
    expect(isAuthCriticalTemplate('password-reset')).toBe(true);
    expect(isAuthCriticalTemplate('email-verification')).toBe(true);
    expect(isAuthCriticalTemplate('admin-invitation')).toBe(false);
    expect(isAuthCriticalTemplate(undefined)).toBe(false);
  });
});

describe('sender domain validation', () => {
  it('normalizes a hostname and rejects urls, the platform domain and local names', () => {
    expect(normalizeDomain(' Bronsgroen.BE. ')).toBe('bronsgroen.be');
    expect(normalizeDomain('https://bronsgroen.be')).toBeNull();
    expect(normalizeDomain('opencoop.be')).toBeNull();
    expect(normalizeDomain('mail.opencoop.be')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('not a domain')).toBeNull();
  });

  it('normalizes an email and rejects a display-name form', () => {
    expect(normalizeEmail(' NoReply@Bronsgroen.be ')).toBe('noreply@bronsgroen.be');
    expect(normalizeEmail('Bronsgroen <noreply@bronsgroen.be>')).toBeNull();
  });
});
