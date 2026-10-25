import { decryptField, encryptField } from './field-encryption';

/** Distinguishes ciphertext from legacy plaintext SMTP / Graph secrets. */
export const STORED_SECRET_PREFIX = 'enc1:';

/** Encrypt a secret for storage. Existing rows without the prefix stay plaintext until rewritten. */
export function encryptStoredSecret(plaintext: string): string {
  return STORED_SECRET_PREFIX + encryptField(plaintext);
}

/**
 * Decrypt a stored secret. Values without the prefix are legacy plaintext and
 * are returned unchanged so mail keeps working until the next save.
 */
export function decryptStoredSecret(stored: string): string {
  if (!stored.startsWith(STORED_SECRET_PREFIX)) return stored;
  return decryptField(stored.slice(STORED_SECRET_PREFIX.length));
}
