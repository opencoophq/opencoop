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

  async validate(payload: { sub: string; email: string; role: string; type?: string; coopIds?: string[] }) {
    // Reject MFA-pending tokens on normal routes
    if (payload.type === 'mfa-pending') {
      throw new UnauthorizedException('MFA verification required');
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      coopIds: payload.coopIds,
    };
  }
}
