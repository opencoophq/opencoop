import * as crypto from 'crypto';

/**
 * Strip whitespace so a code copied from the email (letter-spacing, or a
 * human typing "123 456") still matches the 6 digits we generated.
 */
export function normalizeLoginCode(code: string): string {
  return code.replace(/[\s\u00a0\u2007\u202f]+/g, '');
}

/** Cryptographically uniform 6-digit code, including leading zeros. */
export function generateLoginCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function generateCodeSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** SHA-256 of `salt:code`. The plaintext code is never stored. */
export function hashLoginCode(code: string, salt: string): Buffer {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest();
}

/**
 * Constant-time compare of a submitted code against the stored hash.
 * A length mismatch still runs `timingSafeEqual` so the function does not
 * return early on a malformed hash.
 */
export function codesMatch(code: string, salt: string, codeHashHex: string): boolean {
  const actual = hashLoginCode(normalizeLoginCode(code), salt);
  const expected = Buffer.from(codeHashHex, 'hex');
  if (expected.length !== actual.length || expected.length === 0) {
    crypto.timingSafeEqual(actual, actual);
    return false;
  }
  return crypto.timingSafeEqual(actual, expected);
}
