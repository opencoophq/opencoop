import { Injectable, UnauthorizedException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { AuthEmailService } from './auth-email.service';
import { CoopsService } from '../coops/coops.service';
import { computeTotalPaid, computeVestedShares, TERMS_VERSION, DEFAULT_ROLES } from '@opencoop/shared';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OnboardingDto } from './dto/onboarding.dto';
import { UpgradeToAdultDto } from './dto/upgrade-to-adult.dto';
import { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import { WaitlistDto } from './dto/waitlist.dto';
import { randomBytes } from 'crypto';
import { hashToken } from '../../common/crypto/hash-token';
import { decryptMfaSecret, hashRecoveryCode } from '../../common/crypto';
import * as OTPAuth from 'otpauth';
import { AuditService } from '../audit/audit.service';
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

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
    private authEmail: AuthEmailService,
    private coopsService: CoopsService,
    private auditService: AuditService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        coopAdminOf: {
          select: { coopId: true, roles: { select: { role: { select: { permissions: true } } } } },
        },
      },
    });

    if (!user || !user.passwordHash) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  /**
   * Public wrapper for issueJwtForUser, used by WebAuthn and OAuth flows
   * that authenticate users outside of AuthService.
   */
  issueJwtForUserPublic(user: {
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
  }) {
    return this.issueJwtForUser(user);
  }

  async login(loginDto: LoginDto, ip?: string, userAgent?: string) {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      await this.auditService.log({
        entity: 'Auth',
        entityId: loginDto.email,
        action: 'LOGIN_FAILED',
        changes: [{ field: 'method', oldValue: null, newValue: 'password' }],
        ipAddress: ip,
        userAgent,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.auditService.log({
      entity: 'Auth',
      entityId: user.id,
      action: 'LOGIN',
      changes: [{ field: 'method', oldValue: null, newValue: 'password' }],
      actorId: user.id,
      ipAddress: ip,
      userAgent,
    });

    this.linkOrphanShareholders(user.id, user.email).catch((err) =>
      console.error('Failed to link orphan shareholders:', err.message),
    );

    return this.issueJwtForUser(user);
  }

  async register(registerDto: RegisterDto, ip?: string, userAgent?: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerDto.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(registerDto.password, 12);
    const emailVerifyToken = randomBytes(32).toString('hex');

    const user = await this.prisma.user.create({
      data: {
        email: registerDto.email.toLowerCase(),
        name: registerDto.name,
        passwordHash,
        preferredLanguage: registerDto.preferredLanguage || 'nl',
        emailVerifyToken: hashToken(emailVerifyToken),
        emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    await this.auditService.log({
      entity: 'Auth',
      entityId: user.id,
      action: 'REGISTER',
      changes: [{ field: 'email', oldValue: null, newValue: registerDto.email }],
      actorId: user.id,
      ipAddress: ip,
      userAgent,
    });

    // Send verification email (non-blocking)
    this.authEmail.sendVerificationEmail(user.email, emailVerifyToken, registerDto.preferredLanguage || 'nl').catch((err) => {
      console.error('Failed to send verification email:', err.message);
    });

    // Link any orphan shareholders with matching email
    this.linkOrphanShareholders(user.id, user.email).catch((err) =>
      console.error('Failed to link orphan shareholders:', err.message),
    );

    return this.issueJwtForUser({
      ...user,
      emailVerified: null,
      coopAdminOf: [],
    });
  }

  async onboard(onboardingDto: OnboardingDto) {
    if (!onboardingDto.termsAccepted) {
      throw new BadRequestException('You must accept the terms and conditions');
    }

    const email = onboardingDto.email.toLowerCase();

    // Check email uniqueness
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Check slug uniqueness
    const existingCoop = await this.prisma.coop.findUnique({
      where: { slug: onboardingDto.coopSlug },
    });
    if (existingCoop) {
      throw new ConflictException('Slug already in use');
    }

    const passwordHash = await bcrypt.hash(onboardingDto.password, 12);
    const ogmPrefix = await this.coopsService.generateUniqueOgmPrefix();
    const emailVerifyToken = randomBytes(32).toString('hex');
    const isFree = onboardingDto.plan === 'free';
    const planMap: Record<string, 'FREE' | 'ESSENTIALS' | 'PROFESSIONAL'> = {
      free: 'FREE',
      essentials: 'ESSENTIALS',
      professional: 'PROFESSIONAL',
    };
    const coopPlan = planMap[onboardingDto.plan] || 'FREE';
    const trialEndsAt = isFree ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: onboardingDto.name,
          passwordHash,
          role: 'COOP_ADMIN',
          preferredLanguage: onboardingDto.preferredLanguage || 'nl',
          termsAcceptedAt: new Date(),
          termsVersion: TERMS_VERSION,
          emailVerifyToken: hashToken(emailVerifyToken),
          emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      const coop = await tx.coop.create({
        data: {
          name: onboardingDto.coopName,
          slug: onboardingDto.coopSlug,
          active: true,
          plan: coopPlan,
          trialEndsAt,
          ogmPrefix,
        },
      });

      // Create default roles for the new coop, sourced from the single
      // shared list so adding/removing a permission keeps preset roles
      // consistent across the codebase.
      const roles = await Promise.all(
        Object.entries(DEFAULT_ROLES).map(([name, permissions]) =>
          tx.coopRole.create({
            data: { coopId: coop.id, name, permissions: permissions as unknown as Prisma.InputJsonValue, isDefault: true },
          }),
        ),
      );

      const adminRole = roles.find((r) => r.name === 'Admin')!;

      const coopAdmin = await tx.coopAdmin.create({
        data: {
          userId: user.id,
          coopId: coop.id,
        },
      });
      await tx.coopAdminRole.create({
        data: { coopAdminId: coopAdmin.id, roleId: adminRole.id },
      });

      // Create default channel for the new coop
      await tx.channel.create({
        data: {
          coopId: coop.id,
          slug: 'default',
          name: onboardingDto.coopName,
          isDefault: true,
        },
      });

      return { user, coop };
    });

    // Send verification email (non-blocking)
    this.authEmail.sendVerificationEmail(result.user.email, emailVerifyToken, onboardingDto.preferredLanguage || 'nl').catch((err) => {
      console.error('Failed to send verification email:', err.message);
    });

    // New coop creator gets full Admin permissions
    const adminPermissions = { canManageShareholders: true, canManageTransactions: true, canManageShareClasses: true, canManageProjects: true, canManageDividends: true, canManageSettings: true, canManageAdmins: true, canViewPII: true, canViewReports: true, canViewShareholderRegister: true };

    const tokenResult = await this.issueJwtForUser({
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role,
      preferredLanguage: result.user.preferredLanguage,
      emailVerified: null,
      coopAdminOf: [{
        coopId: result.coop.id,
        permissionOverrides: null,
        roles: [{ role: { permissions: adminPermissions } }],
      }],
    });

    return {
      ...tokenResult,
      coop: {
        id: result.coop.id,
        name: result.coop.name,
        slug: result.coop.slug,
      },
    };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: forgotPasswordDto.email.toLowerCase() },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      return { message: 'If an account exists, a password reset email has been sent' };
    }

    const resetToken = randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 3600000); // 1 hour

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashToken(resetToken),
        passwordResetExpires: resetExpires,
      },
    });

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;
    const t = this.authEmail.getPasswordResetContent(user.preferredLanguage);

    await this.emailService.sendPlatformEmail({
      to: user.email,
      subject: t.subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><style>body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; } h1 { color: #1e40af; }</style></head>
        <body>
          <h1>${t.heading}</h1>
          <p>${t.body}</p>
          <p><a href="${resetUrl}">${resetUrl}</a></p>
          <p>${t.ignore}</p>
          <p>${t.expiry}</p>
          <hr><p style="color: #666; font-size: 12px;">${t.footer}</p>
        </body>
        </html>
      `,
    });

    return { message: 'If an account exists, a password reset email has been sent' };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto, ip?: string, userAgent?: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: hashToken(resetPasswordDto.token),
        passwordResetExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(resetPasswordDto.password, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    await this.auditService.log({
      entity: 'Auth',
      entityId: user.id,
      action: 'PASSWORD_RESET',
      changes: [{ field: 'passwordHash', oldValue: '***', newValue: '***' }],
      actorId: user.id,
      ipAddress: ip,
      userAgent,
    });

    return { message: 'Password reset successfully' };
  }

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        emailVerifyToken: hashToken(token),
        emailVerifyExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: new Date(),
        emailVerifyToken: null,
        emailVerifyExpires: null,
      },
    });

    return { message: 'Email verified successfully' };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        coopAdminOf: {
          include: {
            coop: {
              select: {
                id: true,
                name: true,
                slug: true,
                active: true,
                plan: true,
                trialEndsAt: true,
                channels: {
                  where: { isDefault: true },
                  select: { logoUrl: true },
                  take: 1,
                },
              },
            },
            role: {
              select: { name: true, permissions: true },
            },
          },
        },
        shareholders: {
          include: {
            coop: {
              select: {
                id: true,
                name: true,
                slug: true,
                bankIban: true,
                bankBic: true,
                minimumHoldingPeriod: true,
                channels: {
                  where: { isDefault: true },
                  select: { logoUrl: true },
                  take: 1,
                },
              },
            },
            registrations: {
              include: {
                shareClass: true,
                project: true,
                payments: { orderBy: { bankDate: 'asc' } },
                giftClaimedByShareholder: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
            },
            dividendPayouts: {
              include: {
                dividendPeriod: {
                  include: {
                    coop: { select: { name: true } },
                  },
                },
              },
            },
            documents: {
              orderBy: { generatedAt: 'desc' },
            },
          },
        },
        registeredShareholders: {
          where: { type: 'MINOR' },
          include: {
            coop: {
              select: {
                id: true,
                name: true,
                slug: true,
                bankIban: true,
                bankBic: true,
                minimumHoldingPeriod: true,
                channels: {
                  where: { isDefault: true },
                  select: { logoUrl: true },
                  take: 1,
                },
              },
            },
            registrations: {
              include: {
                shareClass: true,
                project: true,
                payments: { orderBy: { bankDate: 'asc' } },
                giftClaimedByShareholder: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
            },
            dividendPayouts: {
              include: {
                dividendPeriod: {
                  include: {
                    coop: { select: { name: true } },
                  },
                },
              },
            },
            documents: {
              orderBy: { generatedAt: 'desc' },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Exclude sensitive fields
    const { passwordHash, emailVerifyToken, emailVerifyExpires, passwordResetToken, passwordResetExpires, mfaSecret, mfaRecoveryCodes, ...safeUser } = user;

    // SYSTEM_ADMIN can manage all coops, not just ones they're explicitly assigned to
    let adminCoopsRaw = user.coopAdminOf.map((ca) => ca.coop);
    if (user.role === 'SYSTEM_ADMIN') {
      adminCoopsRaw = await this.prisma.coop.findMany({
        select: {
          id: true, name: true, slug: true, active: true, plan: true, trialEndsAt: true,
          channels: { where: { isDefault: true }, select: { logoUrl: true }, take: 1 },
        },
        orderBy: { name: 'asc' },
      });
    }

    // Compute isReadOnly for each coop
    const adminCoops = await Promise.all(
      adminCoopsRaw.map(async (coop) => {
        const full = await this.prisma.coop.findUnique({
          where: { id: coop.id },
          select: { plan: true, trialEndsAt: true, subscription: { select: { status: true } } },
        });
        const isReadOnly = full ? this.computeIsReadOnly(full) : false;
        const { channels, ...rest } = coop as typeof coop & { channels?: { logoUrl: string | null }[] };
        return {
          ...rest,
          logoUrl: channels?.[0]?.logoUrl ?? null,
          plan: full?.plan ?? 'FREE',
          trialEndsAt: full?.trialEndsAt?.toISOString() ?? undefined,
          isReadOnly,
        };
      }),
    );

    // Legacy users (no token AND no verified date) are treated as verified
    const isLegacyUser = !user.emailVerified && !user.emailVerifyToken;
    const emailVerified = !!user.emailVerified || isLegacyUser;

    // C5: Compute sharesOwned for each BUY registration so frontend doesn't fall back to quantity
    const shareholdersWithComputed = safeUser.shareholders.map((s) => ({
      ...s,
      registrations: s.registrations.map((reg) => {
        if (reg.payments) {
          const totalPaid = computeTotalPaid(reg.payments);
          const pricePerShare = Number(reg.pricePerShare);
          const sharesOwned = computeVestedShares(totalPaid, pricePerShare, reg.quantity);
          return {
            ...reg,
            totalPaid,
            sharesOwned,
            sharesRemaining: reg.quantity - sharesOwned,
            fullyPaid: totalPaid >= Number(reg.totalAmount),
          };
        }
        return reg;
      }),
    }));

    // Sort shareholders: INDIVIDUAL first, then COMPANY, then MINOR
    // This ensures dashboard pages (which use shareholders[0]) show the user's own record
    const typePriority = { INDIVIDUAL: 0, COMPANY: 1, MINOR: 2 };
    shareholdersWithComputed.sort((a, b) => (typePriority[a.type] ?? 9) - (typePriority[b.type] ?? 9));

    // Compute vested shares for minor shareholders too
    const minorShareholdersWithComputed = (safeUser as any).registeredShareholders?.map((s: any) => ({
      ...s,
      registrations: s.registrations.map((reg: any) => {
        if (reg.payments) {
          const totalPaid = computeTotalPaid(reg.payments);
          const pricePerShare = Number(reg.pricePerShare);
          const sharesOwned = computeVestedShares(totalPaid, pricePerShare, reg.quantity);
          return {
            ...reg,
            totalPaid,
            sharesOwned,
            sharesRemaining: reg.quantity - sharesOwned,
            fullyPaid: totalPaid >= Number(reg.totalAmount),
          };
        }
        return reg;
      }),
    })) ?? [];

    return {
      ...safeUser,
      shareholders: shareholdersWithComputed,
      minorShareholders: minorShareholdersWithComputed,
      emailVerified,
      hasPassword: !!passwordHash,
      googleLinked: !!user.googleId,
      appleLinked: !!user.appleId,
      adminCoops,
      shareholderCoops: user.shareholders.map((s) => {
        const { channels, ...rest } = s.coop as typeof s.coop & { channels?: { logoUrl: string | null }[] };
        return { ...rest, logoUrl: channels?.[0]?.logoUrl ?? null };
      }),
    };
  }

  async updateProfile(userId: string, data: { name?: string; preferredLanguage?: string }) {
    return this.usersService.updatePreferences(userId, data);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, ip?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.passwordHash) {
      const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValid) {
        throw new BadRequestException('Current password is incorrect');
      }
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    await this.auditService.log({
      entity: 'User',
      entityId: userId,
      action: 'UPDATE',
      changes: [{ field: 'passwordHash', oldValue: '***', newValue: '***' }],
      actorId: userId,
      ipAddress: ip,
      userAgent,
    });

    return { message: 'Password changed successfully' };
  }

  // ============================================================================
  // MFA / TOTP
  // ============================================================================

  async mfaVerify(mfaToken: string, code?: string, recoveryCode?: string, ip?: string, userAgent?: string) {
    let payload: { sub: string; type: string };
    try {
      payload = this.jwtService.verify(mfaToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }

    if (payload.type !== 'mfa-pending') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { coopAdminOf: { select: { coopId: true, permissionOverrides: true, roles: { select: { role: { select: { permissions: true } } } } } } },
    });
    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw new UnauthorizedException('MFA not configured');
    }

    if (recoveryCode) {
      // Recovery code flow
      const hashedInput = hashRecoveryCode(recoveryCode);
      const idx = user.mfaRecoveryCodes.indexOf(hashedInput);
      if (idx === -1) {
        await this.auditService.log({
          entity: 'Auth',
          entityId: user.id,
          action: 'MFA_VERIFY_FAILED',
          changes: [{ field: 'method', oldValue: null, newValue: 'recovery-code' }],
          actorId: user.id,
          ipAddress: ip,
          userAgent,
        });
        throw new BadRequestException('Invalid recovery code');
      }
      // Remove used recovery code
      const updatedCodes = [...user.mfaRecoveryCodes];
      updatedCodes.splice(idx, 1);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { mfaRecoveryCodes: updatedCodes },
      });
    } else if (code) {
      // TOTP code flow
      const secret = decryptMfaSecret(user.mfaSecret);
      const totp = new OTPAuth.TOTP({
        issuer: 'OpenCoop',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(secret),
      });

      const delta = totp.validate({ token: code, window: 1 });
      if (delta === null) {
        await this.auditService.log({
          entity: 'Auth',
          entityId: user.id,
          action: 'MFA_VERIFY_FAILED',
          changes: [{ field: 'method', oldValue: null, newValue: 'totp' }],
          actorId: user.id,
          ipAddress: ip,
          userAgent,
        });
        throw new BadRequestException('Invalid verification code');
      }
    } else {
      throw new BadRequestException('Provide either code or recoveryCode');
    }

    await this.auditService.log({
      entity: 'Auth',
      entityId: user.id,
      action: 'MFA_VERIFY',
      changes: [{ field: 'method', oldValue: null, newValue: recoveryCode ? 'recovery-code' : 'totp' }],
      actorId: user.id,
      ipAddress: ip,
      userAgent,
    });

    // Issue full JWT with permissions and refresh token (mfaAlreadyVerified = true skips the MFA gate)
    return this.issueJwtForUser(user, true);
  }

  // ============================================================================
  // OAUTH (GOOGLE / APPLE)
  // ============================================================================

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
      return this.issueJwtForUser(user);
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
      return this.issueJwtForUser(user);
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

    return this.issueJwtForUser({
      ...newUser,
      coopAdminOf: [],
    });
  }

  // ============================================================================
  // MINOR TO ADULT UPGRADE
  // ============================================================================

  async validateUpgradeToken(token: string) {
    const upgradeToken = await this.prisma.shareholderEmancipationToken.findFirst({
      where: { token, reason: 'MINOR_COMING_OF_AGE' },
      include: {
        shareholder: {
          include: {
            coop: {
              select: {
                id: true,
                name: true,
                slug: true,
                channels: {
                  where: { isDefault: true },
                  select: { logoUrl: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!upgradeToken) {
      throw new NotFoundException('Invalid upgrade token');
    }

    if (upgradeToken.usedAt) {
      throw new BadRequestException('This upgrade token has already been used');
    }

    if (upgradeToken.expiresAt < new Date()) {
      throw new BadRequestException('This upgrade token has expired');
    }

    if (upgradeToken.shareholder.type !== 'MINOR') {
      throw new BadRequestException('This shareholder is not a minor');
    }

    const { channels, ...coopRest } = upgradeToken.shareholder.coop;
    return {
      valid: true,
      shareholder: {
        id: upgradeToken.shareholder.id,
        firstName: upgradeToken.shareholder.firstName,
        lastName: upgradeToken.shareholder.lastName,
        coop: { ...coopRest, logoUrl: channels[0]?.logoUrl ?? null },
      },
    };
  }

  async upgradeMinorToAdult(upgradeDto: UpgradeToAdultDto) {
    // Validate the token first
    const upgradeToken = await this.prisma.shareholderEmancipationToken.findFirst({
      where: { token: upgradeDto.token, reason: 'MINOR_COMING_OF_AGE' },
      include: {
        shareholder: true,
      },
    });

    if (!upgradeToken) {
      throw new NotFoundException('Invalid upgrade token');
    }

    if (upgradeToken.usedAt) {
      throw new BadRequestException('This upgrade token has already been used');
    }

    if (upgradeToken.expiresAt < new Date()) {
      throw new BadRequestException('This upgrade token has expired');
    }

    if (upgradeToken.shareholder.type !== 'MINOR') {
      throw new BadRequestException('This shareholder is not a minor');
    }

    // Check if email is already in use
    const existingUser = await this.prisma.user.findUnique({
      where: { email: upgradeDto.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('This email is already registered');
    }

    // Check if email is already used by another shareholder in same coop
    const existingShareholder = await this.prisma.shareholder.findFirst({
      where: {
        coopId: upgradeToken.shareholder.coopId,
        email: upgradeDto.email.toLowerCase(),
        id: { not: upgradeToken.shareholder.id },
      },
    });

    if (existingShareholder) {
      throw new ConflictException('This email is already used by another shareholder in this cooperative');
    }

    const passwordHash = await bcrypt.hash(upgradeDto.password, 12);

    // Create user and update shareholder in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create the user account
      const user = await tx.user.create({
        data: {
          email: upgradeDto.email.toLowerCase(),
          passwordHash,
          preferredLanguage: upgradeDto.preferredLanguage || 'nl',
          emailVerified: new Date(), // Auto-verify since they used a valid token
        },
      });

      // Update the shareholder record
      await tx.shareholder.update({
        where: { id: upgradeToken.shareholderId },
        data: {
          type: 'INDIVIDUAL',
          email: upgradeDto.email.toLowerCase(),
          userId: user.id,
          registeredByUserId: null, // Remove link to parent
        },
      });

      // Mark the token as used
      await tx.shareholderEmancipationToken.update({
        where: { id: upgradeToken.id },
        data: { usedAt: new Date() },
      });

      return user;
    });

    const tokenResult = await this.issueJwtForUser({
      ...result,
      emailVerified: new Date(),
      coopAdminOf: [],
    });

    return {
      ...tokenResult,
      message: 'Account created successfully. You can now manage your shares.',
    };
  }

  // Generate upgrade token for a minor (called by cron job)
  async generateUpgradeToken(shareholderId: string): Promise<string> {
    const shareholder = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
    });

    if (!shareholder || shareholder.type !== 'MINOR') {
      throw new BadRequestException('Shareholder is not a minor');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90); // Token valid for 90 days

    // Upsert to handle case where token already exists
    await this.prisma.shareholderEmancipationToken.upsert({
      where: { shareholderId },
      create: {
        token,
        shareholderId,
        reason: 'MINOR_COMING_OF_AGE',
        expiresAt,
      },
      update: {
        token,
        reason: 'MINOR_COMING_OF_AGE',
        expiresAt,
        usedAt: null,
        parentNotifiedAt: null,
        reminderSentAt: null,
      },
    });

    return token;
  }

  // ============================================================================
  // MAGIC LINK AUTHENTICATION
  // ============================================================================

  async requestMagicLink(requestMagicLinkDto: RequestMagicLinkDto) {
    const email = requestMagicLinkDto.email.toLowerCase();
    const coopSlug = requestMagicLinkDto.coopSlug;
    const successMessage = { message: 'If an account exists, a login link has been sent' };

    // Find user by email, or auto-create if a shareholder record exists
    let user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Check if a shareholder exists with this email — auto-create a user account
      const shareholder = await this.prisma.shareholder.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, userId: null },
      });

      if (!shareholder) {
        return successMessage;
      }

      user = await this.prisma.user.create({
        data: {
          email,
          name: `${shareholder.firstName} ${shareholder.lastName}`,
          role: 'SHAREHOLDER',
          preferredLanguage: 'nl',
          emailVerified: new Date(),
        },
      });

      // Link this and any other orphan shareholders with the same email
      await this.linkOrphanShareholders(user.id, email);
    }

    // Rate limiting: max 3 unused tokens per user in 15 minutes
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentTokenCount = await this.prisma.magicLinkToken.count({
      where: {
        userId: user.id,
        createdAt: { gte: fifteenMinutesAgo },
        usedAt: null,
      },
    });

    if (recentTokenCount >= 3) {
      // Silently return success to prevent timing attacks
      return successMessage;
    }

    // Generate secure token
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Store token
    await this.prisma.magicLinkToken.create({
      data: {
        token,
        userId: user.id,
        email,
        expiresAt,
      },
    });

    // Build magic link URL with coop branding if coopSlug is provided
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const magicLinkUrl = coopSlug
      ? `${baseUrl}/${coopSlug}/magic-link?token=${token}`
      : `${baseUrl}/magic-link?token=${token}`;

    // Fetch coop branding for the email
    let coopName = 'OpenCoop';
    let brandColor = '#1e40af';
    if (coopSlug) {
      const channel = await this.prisma.channel.findFirst({
        where: { coop: { slug: coopSlug }, isDefault: true },
        include: { coop: { select: { name: true } } },
      });
      if (channel) {
        coopName = channel.coop.name;
        brandColor = channel.primaryColor;
      }
    }

    const t = this.authEmail.getMagicLinkContent(user.preferredLanguage, coopName);

    await this.emailService.sendPlatformEmail({
      to: email,
      subject: t.subject,
      senderName: coopName !== 'OpenCoop' ? coopName : undefined,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><style>body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; } h1 { color: ${brandColor}; }</style></head>
        <body>
          <h1>${t.heading}</h1>
          <p>${t.body}</p>
          <p style="text-align: center; margin: 30px 0;">
            <a href="${magicLinkUrl}"
               style="background-color: ${brandColor}; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              ${t.button}
            </a>
          </p>
          <p style="color: #666; font-size: 12px;">${t.expiry}</p>
          <hr><p style="color: #666; font-size: 12px;">${t.footer}</p>
        </body>
        </html>
      `,
    });

    return successMessage;
  }

  async verifyMagicLink(verifyMagicLinkDto: VerifyMagicLinkDto, ip?: string, userAgent?: string) {
    const { token } = verifyMagicLinkDto;

    // Find and validate token
    const magicLinkToken = await this.prisma.magicLinkToken.findUnique({
      where: { token },
      include: {
        user: {
          include: {
            coopAdminOf: {
              select: { coopId: true, roles: { select: { role: { select: { permissions: true } } } } },
            },
          },
        },
      },
    });

    if (!magicLinkToken) {
      throw new BadRequestException('Invalid login link');
    }

    if (magicLinkToken.usedAt) {
      throw new BadRequestException('This login link has already been used');
    }

    if (magicLinkToken.expiresAt < new Date()) {
      throw new BadRequestException('This login link has expired');
    }

    // Mark token as used atomically (race condition protection)
    const updated = await this.prisma.magicLinkToken.updateMany({
      where: {
        id: magicLinkToken.id,
        usedAt: null, // Only update if not already used
      },
      data: {
        usedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw new BadRequestException('This login link has already been used');
    }

    this.linkOrphanShareholders(magicLinkToken.user.id, magicLinkToken.user.email).catch((err) =>
      console.error('Failed to link orphan shareholders:', err.message),
    );

    await this.auditService.log({
      entity: 'Auth',
      entityId: magicLinkToken.user.id,
      action: 'LOGIN',
      changes: [{ field: 'method', oldValue: null, newValue: 'magic-link' }],
      actorId: magicLinkToken.user.id,
      ipAddress: ip,
      userAgent,
    });

    return this.issueJwtForUser(magicLinkToken.user);
  }

  // ============================================================================
  // WAITLIST
  // ============================================================================

  async joinWaitlist(waitlistDto: WaitlistDto) {
    await this.prisma.waitlistEntry.upsert({
      where: { email: waitlistDto.email.toLowerCase() },
      create: {
        email: waitlistDto.email.toLowerCase(),
        plan: waitlistDto.plan,
      },
      update: {},
    });

    // Send confirmation email to user (don't block or fail the signup)
    this.authEmail.sendWaitlistConfirmationEmail(waitlistDto.email.toLowerCase(), waitlistDto.locale).catch((err) => {
      console.error('Failed to send waitlist confirmation email:', err.message);
    });

    // Notify team
    this.emailService.sendPlatformEmail({
      to: 'hello@opencoop.be',
      subject: `Waitlist signup: ${waitlistDto.email}`,
      text: `New waitlist signup:\n\nEmail: ${waitlistDto.email}\nPlan: ${waitlistDto.plan || 'Not specified'}`,
    }).catch((err) => {
      console.error('Failed to send waitlist notification:', err.message);
    });

    return { message: 'Successfully joined the waitlist' };
  }

  async resendVerificationEmail(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.emailVerified) {
      return { message: 'Email already verified' };
    }

    const emailVerifyToken = randomBytes(32).toString('hex');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerifyToken: hashToken(emailVerifyToken),
        emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await this.authEmail.sendVerificationEmail(user.email, emailVerifyToken, user.preferredLanguage);

    return { message: 'Verification email sent' };
  }


  /**
   * Central JWT issuance. All auth flows (password, magic link, passkey, OAuth)
   * converge here. When MFA is enabled, returns an MFA-pending response instead.
   */
  private async linkOrphanShareholders(userId: string, email: string): Promise<void> {
    await this.prisma.shareholder.updateMany({
      where: { email: { equals: email, mode: 'insensitive' }, userId: null },
      data: { userId },
    });
  }

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

  private async issueJwtForUser(
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

  private computeIsReadOnly(coop: {
    plan: string;
    trialEndsAt: Date | null;
    subscription: { status: string } | null;
  }): boolean {
    if (coop.plan === 'FREE') return false;
    if (coop.subscription?.status === 'ACTIVE') return false;
    if (coop.trialEndsAt && coop.trialEndsAt > new Date()) return false;
    return true;
  }

}
