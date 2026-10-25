import { decryptStoredSecret, encryptStoredSecret, STORED_SECRET_PREFIX } from './stored-secret';

describe('stored secrets', () => {
  const originalKey = process.env.FIELD_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.FIELD_ENCRYPTION_KEY = 'ab'.repeat(32);
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
    else process.env.FIELD_ENCRYPTION_KEY = originalKey;
  });

  it('round-trips a secret and marks it as ciphertext', () => {
    const stored = encryptStoredSecret('smtp-password');

    expect(stored.startsWith(STORED_SECRET_PREFIX)).toBe(true);
    expect(stored).not.toContain('smtp-password');
    expect(decryptStoredSecret(stored)).toBe('smtp-password');
  });

  it('leaves legacy plaintext unchanged', () => {
    expect(decryptStoredSecret('legacy-graph-secret')).toBe('legacy-graph-secret');
  });
});