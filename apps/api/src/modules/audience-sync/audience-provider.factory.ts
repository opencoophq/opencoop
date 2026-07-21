import { decryptField } from '../../common/crypto/field-encryption';
import { EmailAudienceProvider } from './audience-provider.interface';
import { BrevoProvider } from './brevo.provider';

export interface AudienceProviderConfig {
  emailAudienceProvider: string | null;
  brevoApiKey: string | null;
}

export function getAudienceProvider(coop: AudienceProviderConfig): EmailAudienceProvider {
  if (!coop.emailAudienceProvider) {
    throw new Error('Audience sync is not configured for this coop');
  }
  switch (coop.emailAudienceProvider) {
    case 'brevo': {
      if (!coop.brevoApiKey) throw new Error('Brevo API key is missing');
      return new BrevoProvider(decryptField(coop.brevoApiKey));
    }
    default:
      throw new Error(`Unsupported audience provider: ${coop.emailAudienceProvider}`);
  }
}
