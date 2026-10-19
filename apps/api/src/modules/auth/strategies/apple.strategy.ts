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

@Injectable()
export class AppleStrategy extends PassportStrategy(Strategy, 'apple') {
  constructor(configService: ConfigService) {
    super(buildAppleStrategyOptions(configService));
  }

  // Apple sends user info (name, email) via POST body on first auth only
  async validate(
    accessToken: string,
    refreshToken: string,
    idToken: any,
    profile: any,
    done: (err: any, user?: any) => void,
  ) {
    const firstName = profile?.name?.firstName || undefined;
    const lastName = profile?.name?.lastName || undefined;
    const user = {
      appleId: idToken.sub,
      email: idToken.email,
      name: firstName || lastName
        ? `${firstName || ''} ${lastName || ''}`.trim()
        : undefined,
      firstName,
      lastName,
    };
    done(null, user);
  }
}
