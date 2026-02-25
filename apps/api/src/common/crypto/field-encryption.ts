import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.FIELD_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('FIELD_ENCRYPTION_KEY environment variable is required');
  }
  return Buffer.from(key, 'hex');
}

export function encryptField(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: base64(iv + ciphertext + authTag)
  return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

export function decryptField(ciphertext: string): string {
  const key = getKey();
  const data = Buffer.from(ciphertext, 'base64');

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH, data.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * Heuristic check for whether a value is already encrypted.
 * Encrypted values are base64 strings with minimum length (IV + authTag = 28 bytes = ~40 base64 chars).
 * Plain nationalIds are typically short alphanumeric strings (e.g. "93.05.18-223.61").
 */
export function isEncrypted(value: string): boolean {
  if (value.length < 40) return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    // Must be at least IV_LENGTH + AUTH_TAG_LENGTH bytes when decoded
    return decoded.length >= IV_LENGTH + AUTH_TAG_LENGTH && value === decoded.toString('base64');
  } catch {
    return false;
  }
}
