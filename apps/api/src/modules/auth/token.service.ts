import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { hashToken } from '../../common/crypto/hash-token';
import { mergeAdminPermissions } from '../../common/utils/coop-permissions';
import { sessionExpiresAt, sessionRotationDue } from './session-lifetime';

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  preferredLanguage?: string;
  emailVerified?: Date | null;
  mfaEnabled?: boolean;
  coopAdminOf?: {
    coopId: string;
    permissionOverrides?: any;
    roles: { role: { permissions: any } }[];
  }[];
};

type StoredSession = {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  user?: SessionUser;
};

/**
 * JWT issuance and refresh-token lifecycle. Extracted from AuthService — this
 * is the security-critical core that mints access + refresh tokens, handles
 * the MFA-pending branch, rotates refresh tokens, and revokes them. AuthService
 * delegates to this service for all token issuance.
 *
 * A session stays valid until its hard maximum (`expiresAt`, 30 days from the
 * original login). Once the current refresh token is 24 hours old, a client
 * that opts in receives a replacement and the presented token is revoked.
 * Clients that do not opt in keep the original token until it expires, so a
 * deploy does not log existing browsers out.
 */
@Injectable()
export class TokenService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async refreshAccessToken(refreshToken: string, options?: { rotate?: boolean; now?: Date }) {
    const now = options?.now ?? new Date();
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

    if (!storedToken || storedToken.revokedAt || storedToken.expiresAt <= now) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    let session: StoredSession = storedToken;
    let rotatedRefreshToken: string | undefined;
    if (options?.rotate && sessionRotationDue(storedToken.createdAt, now)) {
      const reissued = await this.revokeAndReissue(storedToken, now);
      if (!reissued) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }
      session = { ...storedToken, id: reissued.id, createdAt: now, tokenHash: hashToken(reissued.raw) };
      rotatedRefreshToken = reissued.raw;
    }

    return {
      accessToken: this.signAccessToken(storedToken.user, session),
      ...(rotatedRefreshToken ? { refreshToken: rotatedRefreshToken } : {}),
    };
  }

  /**
   * Reissue a session that is past the rotation interval. Returns null when the
   * row is missing, revoked, expired, still young, or lost a concurrent rotation.
   * A lost race must not fail the authenticated request that triggered it.
   */
  async rotateIfDue(sessionId: string, now = new Date()): Promise<string | null> {
    const stored = await this.prisma.refreshToken.findUnique({ where: { id: sessionId } });
    if (!stored || stored.revokedAt || stored.expiresAt <= now) return null;
    if (!sessionRotationDue(stored.createdAt, now)) return null;
    const reissued = await this.revokeAndReissue(stored, now);
    return reissued?.raw ?? null;
  }

  async revokeRefreshTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async issueJwtForUser(
    user: SessionUser,
    mfaAlreadyVerified = false,
    now = new Date(),
  ) {
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

    const rawRefreshToken = randomBytes(32).toString('hex');
    const created = await this.prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(rawRefreshToken),
        userId: user.id,
        expiresAt: sessionExpiresAt(now),
        createdAt: now,
      },
    });

    return {
      accessToken: this.signAccessToken(user, { id: created.id, createdAt: now }),
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

  private signAccessToken(user: SessionUser, session: { id: string; createdAt: Date }) {
    const coopIds = (user.coopAdminOf ?? []).map((ca) => ca.coopId);
    const coopPermissions: Record<string, any> = {};
    for (const ca of user.coopAdminOf ?? []) {
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
      sid: session.id,
      sst: Math.floor(session.createdAt.getTime() / 1000),
    };

    return this.jwtService.sign(payload, { expiresIn: '15m' });
  }

  /**
   * Revoke the presented row and insert its successor with the same hard
   * expiry. The compare-and-swap keeps two concurrent refreshes from both
   * believing they own the session; the loser gets null.
   */
  private async revokeAndReissue(
    stored: { id: string; userId: string; expiresAt: Date },
    now: Date,
  ): Promise<{ id: string; raw: string } | null> {
    const raw = randomBytes(32).toString('hex');
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (claimed.count !== 1) return null;
      const created = await tx.refreshToken.create({
        data: {
          tokenHash: hashToken(raw),
          userId: stored.userId,
          expiresAt: stored.expiresAt,
          createdAt: now,
        },
      });
      return { id: created.id, raw };
    });
  }
}
