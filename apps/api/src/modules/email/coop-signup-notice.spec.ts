import { buildCoopCreatedMail, coopSignupNotifyRecipient } from './coop-signup-notice';

const notice = {
  coopId: 'coop-1',
  name: 'Zukunftdorf Billberge',
  slug: 'zukunftdorf-billberge',
  plan: 'FREE',
  legalForm: 'eingetragene Genossenschaft',
  country: 'DE',
  adminEmail: 'ada@zukunftdorf.example',
  language: 'de',
  createdAt: new Date('2026-08-13T12:00:00.000Z'),
  source: 'self-signup' as const,
};

describe('coop signup notification', () => {
  it('defaults the recipient to info@opencoop.be and treats off as disabled', () => {
    expect(coopSignupNotifyRecipient(undefined)).toBe('info@opencoop.be');
    expect(coopSignupNotifyRecipient('')).toBe('info@opencoop.be');
    expect(coopSignupNotifyRecipient('  ')).toBe('info@opencoop.be');
    expect(coopSignupNotifyRecipient('off')).toBeNull();
    expect(coopSignupNotifyRecipient(' OFF ')).toBeNull();
    expect(coopSignupNotifyRecipient('ops@armlab.example')).toBe('ops@armlab.example');
  });

  it('writes a Dutch notice with the environment in the subject and a platform link', () => {
    const mail = buildCoopCreatedMail(notice, {
      FRONTEND_URL: 'https://acc.opencoop.be',
      NODE_ENV: 'production',
    });

    expect(mail).toEqual(
      expect.objectContaining({
        to: 'info@opencoop.be',
        subject: '[acc] Nieuwe coöperatie: Zukunftdorf Billberge',
      }),
    );
    expect(mail?.text).toContain('Naam: Zukunftdorf Billberge');
    expect(mail?.text).toContain('Slug: zukunftdorf-billberge');
    expect(mail?.text).toContain('Plan: FREE');
    expect(mail?.text).toContain('Rechtsvorm: eingetragene Genossenschaft');
    expect(mail?.text).toContain('Land: DE');
    expect(mail?.text).toContain('Beheerder: ada@zukunftdorf.example');
    expect(mail?.text).toContain('Taal: de');
    expect(mail?.text).toContain('2026-08-13T12:00:00.000Z');
    expect(mail?.text).toContain('Omgeving: acc');
    expect(mail?.text).toContain('Bron: zelfregistratie');
    expect(mail?.text).toContain(
      'Platform: https://acc.opencoop.be/nl/dashboard/system/coops/coop-1/admins',
    );
  });

  it('leaves production unlabeled and says when rechtsvorm and land are unknown', () => {
    const mail = buildCoopCreatedMail(
      {
        ...notice,
        legalForm: null,
        country: null,
        source: 'superadmin',
        adminEmail: null,
        createdByEmail: 'wouter@armlab.example',
      },
      { FRONTEND_URL: 'https://opencoop.be', NODE_ENV: 'production' },
    );

    expect(mail?.subject).toBe('Nieuwe coöperatie: Zukunftdorf Billberge');
    expect(mail?.subject).not.toMatch(/\[/);
    expect(mail?.text).toContain('Rechtsvorm: onbekend');
    expect(mail?.text).toContain('Land: onbekend');
    expect(mail?.text).toContain('Beheerder: nog niet ingesteld');
    expect(mail?.text).toContain('Bron: superadmin');
    expect(mail?.text).toContain('Aangemaakt door: wouter@armlab.example');
    expect(mail?.text).not.toContain('Omgeving:');
    expect(mail?.text).not.toMatch(/\bprod(?:uction)?\b/i);
  });

  it('prefixes acc with [acc] and other non-production environments with their name', () => {
    const acc = buildCoopCreatedMail(notice, {
      FRONTEND_URL: 'https://acc.opencoop.be',
      NODE_ENV: 'production',
    });
    expect(acc?.subject).toBe('[acc] Nieuwe coöperatie: Zukunftdorf Billberge');
    expect(acc?.text).toContain('Omgeving: acc');

    const namedProduction = buildCoopCreatedMail(notice, {
      FRONTEND_URL: 'https://opencoop.be',
      SENTRY_ENVIRONMENT: 'production',
      NODE_ENV: 'production',
    });
    expect(namedProduction?.subject).toBe('Nieuwe coöperatie: Zukunftdorf Billberge');
    expect(namedProduction?.text).not.toContain('Omgeving:');
    expect(namedProduction?.text).not.toMatch(/\bprod(?:uction)?\b/i);

    const dev = buildCoopCreatedMail(notice, {
      FRONTEND_URL: 'http://localhost:3002',
      NODE_ENV: 'development',
    });
    expect(dev?.subject).toBe('[development] Nieuwe coöperatie: Zukunftdorf Billberge');
    expect(dev?.text).toContain('Omgeving: development');

    const local = buildCoopCreatedMail(notice, {
      FRONTEND_URL: 'http://localhost:3002',
      SENTRY_ENVIRONMENT: 'local',
      NODE_ENV: 'development',
    });
    expect(local?.subject).toBe('[local] Nieuwe coöperatie: Zukunftdorf Billberge');
    expect(local?.text).toContain('Omgeving: local');
  });

  it('does not build a message when notifications are off, and strips header injection', () => {
    expect(buildCoopCreatedMail(notice, { COOP_SIGNUP_NOTIFY_EMAIL: 'off' })).toBeNull();

    const mail = buildCoopCreatedMail(
      { ...notice, name: 'Evil\r\nBcc: spam@example.com' },
      { COOP_SIGNUP_NOTIFY_EMAIL: 'info@opencoop.be', NODE_ENV: 'test' },
    );
    expect(mail?.subject).not.toMatch(/[\r\n]/);
    expect(mail?.subject).toContain('Evil Bcc: spam@example.com');
    expect(mail?.to).toBe('info@opencoop.be');
  });
});
