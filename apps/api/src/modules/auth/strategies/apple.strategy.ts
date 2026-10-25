import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-apple';
import type { AuthenticateOptions } from 'passport-apple';
import { ConfigService } from '@nestjs/config';

export function buildAppleStrategyOptions(configService: ConfigService): AuthenticateOptions {
  return {
    clientID: configService.get<string>('APPLE_CLIENT_ID') as string,
    teamID: configService.get<string>('APPLE_TEAM_ID') as string,
    keyID: configService.get<string>('APPLE_KEY_ID') as string,
    // passport-apple only reads `privateKeyLocation` / `privateKeyString`.
    // The previous `keyFilePath` option was silently ignored, so the client
    // secret was signed with an undefined key and every Apple login 500'd.
    // The key itself is checked at boot by resolveAppleLogin().
    privateKeyLocation: configService.get<string>('APPLE_KEY_PATH'),
    callbackURL: configService.get<string>('APPLE_CALLBACK_URL'),
    scope: ['name', 'email'],
    passReqToCallback: false,
  };
}

/** Decode the Apple id_token JWT payload (no signature check; Apple already issued it). */
export function decodeAppleIdToken(idToken: string | Record<string, unknown>): {
  sub?: string;
  email?: string;
} {
  if (idToken && typeof idToken === 'object') {
    return idToken as { sub?: string; email?: string };
  }
  if (typeof idToken !== 'string' || !idToken.includes('.')) {
    throw new Error('Apple id_token is missing or not a JWT');
  }
  const payload = idToken.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

/**
 * The third PassportStrategy argument (5) sets the Nest verify-wrapper length so
 * passport-oauth2 calls `_verify(accessToken, refreshToken, params, profile, done)`
 * with Apple's id_token as `params`. Without it, Nest registers length 0, oauth2
 * takes the 4-arg branch, and validate's `done` param is undefined →
 * `TypeError: done is not a function` (GlitchTip #56 after v2026.43.3).
 *
 * NestJS already invokes `done` from the return value; do not call `done` here.
 */
@Injectable()
export class AppleStrategy extends PassportStrategy(Strategy, 'apple', 5) {
  constructor(configService: ConfigService) {
    super(buildAppleStrategyOptions(configService));
  }

  // Apple sends name via POST body on first auth only; email/sub live in id_token.
  async validate(
    _accessToken: string,
    _refreshToken: string,
    idToken: string,
    profile: Record<string, any>,
  ) {
    const claims = decodeAppleIdToken(idToken);
    if (!claims.sub) {
      throw new Error('Apple id_token is missing sub');
    }
    const firstName = profile?.name?.firstName || undefined;
    const lastName = profile?.name?.lastName || undefined;
    return {
      appleId: claims.sub,
      email: claims.email,
      name: firstName || lastName
        ? `${firstName || ''} ${lastName || ''}`.trim()
        : undefined,
      firstName,
      lastName,
    };
  }
}
