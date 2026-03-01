import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-apple';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppleStrategy extends PassportStrategy(Strategy, 'apple') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get<string>('APPLE_CLIENT_ID'),
      teamID: configService.get<string>('APPLE_TEAM_ID'),
      keyID: configService.get<string>('APPLE_KEY_ID'),
      keyFilePath: configService.get<string>('APPLE_KEY_PATH'),
      callbackURL: configService.get<string>('APPLE_CALLBACK_URL'),
      scope: ['name', 'email'],
      passReqToCallback: false,
    });
  }

  // Apple sends user info (name, email) via POST body on first auth only
  async validate(
    accessToken: string,
    refreshToken: string,
    idToken: any,
    profile: any,
    done: (err: any, user?: any) => void,
  ) {
    const user = {
      appleId: idToken.sub,
      email: idToken.email,
      name: profile?.name
        ? `${profile.name.firstName || ''} ${profile.name.lastName || ''}`.trim()
        : undefined,
    };
    done(null, user);
  }
}
