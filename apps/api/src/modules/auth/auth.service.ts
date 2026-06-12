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
import { WaitlistDto } from './dto/waitlist.dto';
import { randomBytes } from 'crypto';
import { hashToken } from '../../common/crypto/hash-token';
import { decryptMfaSecret, hashRecoveryCode } from '../../common/crypto';
import * as OTPAuth from 'otpauth';
import { AuditService } from '../audit/audit.service';
import { TokenService } from './token.service';
import { computeIsReadOnly } from './compute-readonly';

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
    private tokenService: TokenService,
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
    return this.tokenService.issueJwtForUser(user);
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

    return this.tokenService.issueJwtForUser(user);
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

    return this.tokenService.issueJwtForUser({
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

    const tokenResult = await this.tokenService.issueJwtForUser({
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
        const isReadOnly = full ? computeIsReadOnly(full) : false;
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
    return this.tokenService.issueJwtForUser(user, true);
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

    const tokenResult = await this.tokenService.issueJwtForUser({
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

}
