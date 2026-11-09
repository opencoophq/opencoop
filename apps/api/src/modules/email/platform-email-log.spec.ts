import {
  buildPlatformEmailLog,
  collectMailSecrets,
  extractProviderMessageId,
  outcomeFromSmtpError,
  outcomeFromSmtpResult,
} from './platform-email-log';

describe('platform email log', () => {
  const loginCode = '482913';
  const magicToken = 'ab'.repeat(32);
  const resetToken = 'cd'.repeat(32);

  describe('extractProviderMessageId', () => {
    it('reads the Brevo id from "queued as <id>"', () => {
      expect(
        extractProviderMessageId(
          '250 2.0.0 Ok: queued as <20261109.abc@smtp-relay.mailin.fr>',
          '<client@opencoop.be>',
        ),
      ).toBe('20261109.abc@smtp-relay.mailin.fr');
    });

    it('reads an unbracketed queued-as id and an id= reply', () => {
      expect(extractProviderMessageId('250 OK: queued as 3/abc-123', null)).toBe('3/abc-123');
      expect(extractProviderMessageId('250 OK id=brevo-msg-42', '<ignored@host>')).toBe(
        'brevo-msg-42',
      );
    });

    it('falls back to the Message-ID submitted to the relay', () => {
      expect(extractProviderMessageId('250 2.0.0 Ok', '<fallback-id@opencoop.be>')).toBe(
        'fallback-id@opencoop.be',
      );
      expect(extractProviderMessageId(undefined, undefined)).toBeNull();
    });
  });

  describe('outcomes', () => {
    it('treats a resolved send as accepted and an all-rejected envelope as rejected', () => {
      expect(
        outcomeFromSmtpResult({
          accepted: ['member@example.com'],
          rejected: [],
          response: '250 2.0.0 Ok: queued as <id@smtp-relay.mailin.fr>',
          messageId: '<id@smtp-relay.mailin.fr>',
        }),
      ).toEqual({
        status: 'ACCEPTED',
        smtpResponse: '250 2.0.0 Ok: queued as <id@smtp-relay.mailin.fr>',
        providerMessageId: 'id@smtp-relay.mailin.fr',
        errorMessage: null,
      });

      expect(
        outcomeFromSmtpResult({
          accepted: [],
          rejected: ['member@example.com'],
          response: '550 5.1.1 User unknown',
        }).status,
      ).toBe('REJECTED');
    });

    it('classifies SMTP rejects separately from transport errors', () => {
      expect(
        outcomeFromSmtpError(
          Object.assign(new Error('Message failed: 550'), {
            responseCode: 550,
            response: '550 no',
            code: 'EENVELOPE',
          }),
        ).status,
      ).toBe('REJECTED');

      expect(
        outcomeFromSmtpError(
          Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' }),
        ).status,
      ).toBe('ERROR');
    });
  });

  describe('secrets', () => {
    const html = `<p>Je inlogcode: ${loginCode}</p><a href="https://opencoop.be/magic-link?token=${magicToken}">x</a>`;
    const text = `https://opencoop.be/reset-password?token=${resetToken}`;

    it('finds the login code and both link tokens in the body', () => {
      const secrets = collectMailSecrets(html, text);
      expect(secrets).toEqual(expect.arrayContaining([loginCode, magicToken, resetToken]));
    });

    it('writes a row whose serialized form contains none of those secrets', () => {
      const secrets = collectMailSecrets(html, text, `subject ${loginCode}`);
      const row = buildPlatformEmailLog({
        to: 'member@example.com',
        subject: `Je code ${loginCode}`,
        templateKey: 'magic-link',
        coopId: 'coop-1',
        status: 'REJECTED',
        smtpResponse: `550 token=${magicToken} reset=${resetToken} code ${loginCode}`,
        providerMessageId: magicToken,
        errorMessage: `failed ${resetToken}`,
        sentAt: null,
        secrets,
      });

      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain(loginCode);
      expect(serialized).not.toContain(magicToken);
      expect(serialized).not.toContain(resetToken);
      expect(row).not.toHaveProperty('html');
      expect(row).not.toHaveProperty('text');
      expect(row.subject).toBe('Je code [redacted]');
      expect(row.providerMessageId).toBe('[redacted]');
      expect(row.status).toBe('REJECTED');
      expect(row.sentAt).toBeNull();
    });
  });
});
