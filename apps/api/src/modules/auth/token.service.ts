import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { hashToken } from '../../common/crypto/hash-token';

/**
 * OR-merge permissions across all roles assigned to a CoopAdmin, then apply
 * the per-admin overrides on top. An admin with N roles has the union of
 * their permissions: as soon as ANY role grants `canX`, the admin has `canX`.
 * Overrides win unconditionally — a `false` override switches a granted
 * permission off, a `true` override grants something no role provided.
 */
function mergeAdminPermissions(
  rolePermissionsList: unknown[],
  overrides: unknown,
): Record<string, boolean> {
  const merged: Record<string, boolean> = {};
  for (const perms of rolePermissionsList) {
    const obj = (perms ?? {}) as Record<string, boolean>;
    for (const [key, value] of Object.entries(obj)) {
      merged[key] = merged[key] || value === true;
    }
  }
  const overrideObj = (overrides ?? {}) as Record<string, boolean>;
  return { ...merged, ...overrideObj };
}

/**
 * JWT issuance and refresh-token lifecycle. Extracted from AuthService — this
 * is the security-critical core that mints access + refresh tokens, handles
 * the MFA-pending branch, rotates refresh tokens, and revokes them. AuthService
 * delegates to this service for all token issuance.
 */
@Injectable()
export class TokenService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async refreshAccessToken(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            coopAdminOf: {
              include: {
                roles: { include: { role: true } },
              },
            },
          },
        },
      },
    });

    if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = storedToken.user;
    const coopIds = user.coopAdminOf.map((ca) => ca.coopId);
    const coopPermissions: Record<string, any> = {};
    for (const ca of user.coopAdminOf) {
      coopPermissions[ca.coopId] = mergeAdminPermissions(
        ca.roles.map((r) => r.role.permissions),
        ca.permissionOverrides,
      );
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      ...(coopIds.length > 0 && { coopIds }),
      ...(Object.keys(coopPermissions).length > 0 && { coopPermissions }),
    };

    return {
      accessToken: this.jwtService.sign(payload, { expiresIn: '15m' }),
    };
  }

  async revokeRefreshTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async issueJwtForUser(
    user: {
      id: string;
      email: string;
      name: string | null;
      role: string;
      preferredLanguage: string;
      emailVerified: Date | null;
      mfaEnabled?: boolean;
      coopAdminOf?: {
        coopId: string;
        permissionOverrides?: any;
        roles: { role: { permissions: any } }[];
      }[];
    },
    mfaAlreadyVerified = false,
  ) {
    const coopIds = (user.coopAdminOf ?? []).map((ca) => ca.coopId);
    const coopPermissions: Record<string, any> = {};
    for (const ca of user.coopAdminOf ?? []) {
      coopPermissions[ca.coopId] = mergeAdminPermissions(
        ca.roles.map((r) => r.role.permissions),
        ca.permissionOverrides,
      );
    }

    // If MFA is enabled and not yet verified, issue a short-lived mfa-pending token
    if (user.mfaEnabled && !mfaAlreadyVerified) {
      const mfaPayload = {
        sub: user.id,
        type: 'mfa-pending',
      };
      return {
        requiresMfa: true,
        mfaToken: this.jwtService.sign(mfaPayload, { expiresIn: '5m' }),
      };
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      ...(coopIds.length > 0 && { coopIds }),
      ...(Object.keys(coopPermissions).length > 0 && { coopPermissions }),
    };

    // Generate refresh token
    const rawRefreshToken = randomBytes(32).toString('hex');
    const refreshTokenHash = hashToken(rawRefreshToken);
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: refreshTokenHash,
        userId: user.id,
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      accessToken: this.jwtService.sign(payload, { expiresIn: '15m' }),
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        emailVerified: !!user.emailVerified,
      },
    };
  }
}
