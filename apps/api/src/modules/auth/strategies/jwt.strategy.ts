import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    role: string;
    type?: string;
    coopIds?: string[];
    coopPermissions?: Record<string, any>;
    sid?: string;
    sst?: number;
  }) {
    // Reject MFA-pending tokens on normal routes
    if (payload.type === 'mfa-pending') {
      throw new UnauthorizedException('MFA verification required');
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      coopIds: payload.coopIds,
      coopPermissions: payload.coopPermissions,
      // Present only on access tokens issued with a server-side session.
      // Older access tokens omit both and keep working until they expire.
      ...(payload.sid ? { sid: payload.sid } : {}),
      ...(typeof payload.sst === 'number' ? { sst: payload.sst } : {}),
    };
  }
}
