import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { readFileSync } from 'fs';

const logger = new Logger('AppleLogin');

let appleLoginEnabled = false;

export type AppleKeyCheck = { ok: true } | { ok: false; reason: string };

/** Checks that the Apple .p8 key at `keyPath` exists, is readable and is a PEM private key. */
export function checkApplePrivateKey(keyPath: string | undefined): AppleKeyCheck {
  if (!keyPath) return { ok: false, reason: 'APPLE_KEY_PATH is not set' };
  let key: string;
  try {
    key = readFileSync(keyPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? 'unknown error';
    return { ok: false, reason: `cannot read private key at APPLE_KEY_PATH=${keyPath} (${code})` };
  }
  if (!key.includes('PRIVATE KEY')) {
    return { ok: false, reason: `file at APPLE_KEY_PATH=${keyPath} is not a PEM private key` };
  }
  return { ok: true };
}

/**
 * Decides at boot whether Sign in with Apple is available. Without
 * APPLE_CLIENT_ID it is simply off. With APPLE_CLIENT_ID but a missing,
 * unreadable or invalid key it is also off, but loudly: logged as an error and
 * reported to GlitchTip. The API keeps running either way; /auth/apple then
 * sends people to /login?error=oauth instead of a 500.
 */
export function resolveAppleLogin(env: NodeJS.ProcessEnv = process.env): boolean {
  appleLoginEnabled = false;
  if (!env.APPLE_CLIENT_ID) return false;

  const check = checkApplePrivateKey(env.APPLE_KEY_PATH);
  if (!check.ok) {
    const message = `Sign in with Apple DISABLED: ${check.reason}`;
    logger.error(message);
    Sentry.captureMessage(message, 'error');
    return false;
  }

  appleLoginEnabled = true;
  return true;
}

export function isAppleLoginEnabled(): boolean {
  return appleLoginEnabled;
}
