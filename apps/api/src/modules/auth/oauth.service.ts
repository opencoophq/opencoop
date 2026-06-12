import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TokenService } from './token.service';

/**
 * OAuth (Google / Apple) login. Extracted from AuthService — resolves or
 * provisions a User from a provider identity, links any orphan shareholders,
 * audits the login, and delegates JWT issuance to TokenService. AuthController
 * delegates the OAuth callbacks here.
 */
@Injectable()
export class OAuthService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private tokenService: TokenService,
  ) {}

  async handleOAuthLogin(provider: 'google' | 'apple', data: { providerId: string; email: string; name?: string }, ip?: string, userAgent?: string) {
    const providerIdField = provider === 'google' ? 'googleId' : 'appleId';

    // 1. Check if user already linked by provider ID
    let user = await this.prisma.user.findFirst({
      where: { [providerIdField]: data.providerId },
      include: { coopAdminOf: { select: { coopId: true, permissionOverrides: true, roles: { select: { role: { select: { permissions: true } } } } } } },
    });

    if (user) {
      this.linkOrphanShareholders(user.id, user.email).catch((err) =>
        console.error('Failed to link orphan shareholders:', err.message),
      );
      await this.auditService.log({
        entity: 'Auth',
        entityId: user.id,
        action: 'LOGIN',
        changes: [{ field: 'method', oldValue: null, newValue: provider }],
        actorId: user.id,
        ipAddress: ip,
        userAgent,
      });
      return this.tokenService.issueJwtForUser(user);
    }

    // 2. Check if user exists by email
    user = await this.prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
      include: { coopAdminOf: { select: { coopId: true, permissionOverrides: true, roles: { select: { role: { select: { permissions: true } } } } } } },
    });

    if (user) {
      // Link provider to existing user
      await this.prisma.user.update({
        where: { id: user.id },
        data: { [providerIdField]: data.providerId },
      });
      this.linkOrphanShareholders(user.id, user.email).catch((err) =>
        console.error('Failed to link orphan shareholders:', err.message),
      );
      await this.auditService.log({
        entity: 'Auth',
        entityId: user.id,
        action: 'LOGIN',
        changes: [{ field: 'method', oldValue: null, newValue: provider }],
        actorId: user.id,
        ipAddress: ip,
        userAgent,
      });
      return this.tokenService.issueJwtForUser(user);
    }

    // 3. Create new user (no password, OAuth-only)
    const newUser = await this.prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        name: data.name || null,
        [providerIdField]: data.providerId,
        emailVerified: new Date(), // OAuth-verified email
      },
    });

    this.linkOrphanShareholders(newUser.id, newUser.email).catch((err) =>
      console.error('Failed to link orphan shareholders:', err.message),
    );

    await this.auditService.log({
      entity: 'Auth',
      entityId: newUser.id,
      action: 'LOGIN',
      changes: [{ field: 'method', oldValue: null, newValue: provider }],
      actorId: newUser.id,
      ipAddress: ip,
      userAgent,
    });

    return this.tokenService.issueJwtForUser({
      ...newUser,
      coopAdminOf: [],
    });
  }

  private async linkOrphanShareholders(userId: string, email: string): Promise<void> {
    await this.prisma.shareholder.updateMany({
      where: { email: { equals: email, mode: 'insensitive' }, userId: null },
      data: { userId },
    });
  }
}
