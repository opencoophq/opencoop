import { getAudienceProvider } from './audience-provider.factory';
import { BrevoProvider } from './brevo.provider';

jest.mock('../../common/crypto/field-encryption', () => ({
  decryptField: (c: string) => `plain:${c}`,
}));

describe('getAudienceProvider', () => {
  it('returns a BrevoProvider for "brevo" with decrypted key', () => {
    const p = getAudienceProvider({ emailAudienceProvider: 'brevo', brevoApiKey: 'enc' });
    expect(p).toBeInstanceOf(BrevoProvider);
  });

  it('throws when provider is null', () => {
    expect(() => getAudienceProvider({ emailAudienceProvider: null, brevoApiKey: null }))
      .toThrow(/not configured/i);
  });

  it('throws for an unimplemented provider', () => {
    expect(() => getAudienceProvider({ emailAudienceProvider: 'mailchimp', brevoApiKey: 'enc' }))
      .toThrow(/mailchimp/i);
  });

  it('throws when brevo has no api key', () => {
    expect(() => getAudienceProvider({ emailAudienceProvider: 'brevo', brevoApiKey: null }))
      .toThrow(/api key/i);
  });
});
