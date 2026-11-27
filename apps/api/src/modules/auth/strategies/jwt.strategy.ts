import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
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
    sv?: number;
  }) {
    // Reject MFA-pending tokens on normal routes
    if (payload.type === 'mfa-pending') {
      throw new UnauthorizedException('MFA verification required');
    }

    // One primary-key lookup per request. A deleted user fails here, and a
    // logout, password change or email change bumps sessionVersion, which
    // kills every access token signed before it. Tokens signed before the
    // `sv` claim existed count as version 0, so they keep working until the
    // user's first revocation or their 15-minute expiry.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { sessionVersion: true },
    });
    if (!user || (payload.sv ?? 0) !== user.sessionVersion) {
      throw new UnauthorizedException('Session revoked');
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
