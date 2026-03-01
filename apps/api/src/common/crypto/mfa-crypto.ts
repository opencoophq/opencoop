import { randomBytes, createHash } from 'crypto';
import { encryptField, decryptField } from './field-encryption';

/**
 * Encrypt a TOTP secret for database storage.
 * Reuses FIELD_ENCRYPTION_KEY (AES-256-GCM).
 */
export function encryptMfaSecret(secret: string): string {
  return encryptField(secret);
}

/**
 * Decrypt a stored TOTP secret.
 */
export function decryptMfaSecret(encrypted: string): string {
  return decryptField(encrypted);
}

/**
 * Generate a set of single-use recovery codes (8 codes, 10 chars each).
 * Returns both plaintext (to show user once) and hashed (to store).
 */
export function generateRecoveryCodes(): { plain: string[]; hashed: string[] } {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    codes.push(randomBytes(5).toString('hex')); // 10 hex chars
  }
  return {
    plain: codes,
    hashed: codes.map(hashRecoveryCode),
  };
}

/**
 * SHA-256 hash a recovery code for secure storage.
 */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.toLowerCase().replace(/\s/g, '')).digest('hex');
}
