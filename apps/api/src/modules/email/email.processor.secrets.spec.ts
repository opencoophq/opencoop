jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({}) })),
}));

jest.mock('@azure/identity', () => ({
  ClientSecretCredential: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@microsoft/microsoft-graph-client', () => ({
  Client: {
    initWithMiddleware: jest.fn(() => ({
      api: jest.fn(() => ({ post: jest.fn().mockResolvedValue({}) })),
    })),
  },
}));

jest.mock('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials', () => ({
  TokenCredentialAuthenticationProvider: jest.fn(),
}));

import * as nodemailer from 'nodemailer';
import { ClientSecretCredential } from '@azure/identity';
import { EmailProcessor } from './email.processor';
import { encryptStoredSecret } from '../../common/crypto/stored-secret';

describe('EmailProcessor stored mail secrets', () => {
  const originalKey = process.env.FIELD_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.FIELD_ENCRYPTION_KEY = 'ab'.repeat(32);
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
    else process.env.FIELD_ENCRYPTION_KEY = originalKey;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function processor() {
    return new EmailProcessor({} as any);
  }

  const coopBase = {
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUser: 'mailer',
    smtpFrom: 'coop@example.com',
    coopEmail: 'info@example.com',
    name: 'Coop',
  };

  it('decrypts an enc1 SMTP password before opening the transport', async () => {
    await (processor() as any).sendViaSmtp(
      { ...coopBase, smtpPass: encryptStoredSecret('plain-smtp') },
      'member@example.com',
      'Hello',
      '<p>Hi</p>',
    );

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: 'mailer', pass: 'plain-smtp' },
      }),
    );
  });

  it('still sends a legacy plaintext SMTP password', async () => {
    await (processor() as any).sendViaSmtp(
      { ...coopBase, smtpPass: 'legacy-smtp' },
      'member@example.com',
      'Hello',
      '<p>Hi</p>',
    );

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: 'mailer', pass: 'legacy-smtp' },
      }),
    );
  });

  it('decrypts an enc1 Graph client secret before building the credential', async () => {
    await (processor() as any).sendViaGraph(
      {
        graphClientId: 'client',
        graphClientSecret: encryptStoredSecret('plain-graph'),
        graphTenantId: 'tenant',
        graphFromEmail: 'coop@example.com',
        coopEmail: null,
        name: 'Coop',
      },
      'member@example.com',
      'Hello',
      '<p>Hi</p>',
    );

    expect(ClientSecretCredential).toHaveBeenCalledWith('tenant', 'client', 'plain-graph');
  });
});