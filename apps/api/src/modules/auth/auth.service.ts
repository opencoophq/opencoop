import { Injectable, UnauthorizedException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpgradeToAdultDto } from './dto/upgrade-to-adult.dto';
import { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        coopAdminOf: {
          select: { coopId: true },
        },
      },
    });

    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const coopIds = user.coopAdminOf.map((ca) => ca.coopId);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      ...(coopIds.length > 0 && { coopIds }),
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        emailVerified: !!user.emailVerified,
      },
    };
  }

  async register(registerDto: RegisterDto) {
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
        passwordHash,
        preferredLanguage: registerDto.preferredLanguage || 'nl',
        emailVerifyToken,
      },
    });

    // TODO: Send verification email

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        emailVerified: false,
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
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpires,
      },
    });

    // TODO: Send password reset email

    return { message: 'If an account exists, a password reset email has been sent' };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: resetPasswordDto.token,
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

    return { message: 'Password reset successfully' };
  }

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findFirst({
      where: { emailVerifyToken: token },
    });

    if (!user) {
      throw new BadRequestException('Invalid verification token');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: new Date(),
        emailVerifyToken: null,
      },
    });

    return { message: 'Email verified successfully' };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        preferredLanguage: true,
        emailVerified: true,
        createdAt: true,
        coopAdminOf: {
          include: {
            coop: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
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
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      ...user,
      emailVerified: !!user.emailVerified,
      adminCoops: user.coopAdminOf.map((ca) => ca.coop),
      shareholderCoops: user.shareholders.map((s) => s.coop),
    };
  }

  // ============================================================================
  // MINOR TO ADULT UPGRADE
  // ============================================================================

  async validateUpgradeToken(token: string) {
    const upgradeToken = await this.prisma.minorUpgradeToken.findUnique({
      where: { token },
      include: {
        shareholder: {
          include: {
            coop: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
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

    return {
      valid: true,
      shareholder: {
        id: upgradeToken.shareholder.id,
        firstName: upgradeToken.shareholder.firstName,
        lastName: upgradeToken.shareholder.lastName,
        coop: upgradeToken.shareholder.coop,
      },
    };
  }

  async upgradeMinorToAdult(upgradeDto: UpgradeToAdultDto) {
    // Validate the token first
    const upgradeToken = await this.prisma.minorUpgradeToken.findUnique({
      where: { token: upgradeDto.token },
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
      await tx.minorUpgradeToken.update({
        where: { id: upgradeToken.id },
        data: { usedAt: new Date() },
      });

      return user;
    });

    // Generate JWT for the new user
    const payload = {
      sub: result.id,
      email: result.email,
      role: result.role,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: result.id,
        email: result.email,
        role: result.role,
        preferredLanguage: result.preferredLanguage,
        emailVerified: true,
      },
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
    await this.prisma.minorUpgradeToken.upsert({
      where: { shareholderId },
      create: {
        token,
        shareholderId,
        expiresAt,
      },
      update: {
        token,
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
    const successMessage = { message: 'If an account exists, a login link has been sent' };

    // Find user by email
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        shareholders: {
          take: 1,
          select: { coopId: true },
        },
      },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      return successMessage;
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

    // Build magic link URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const magicLinkUrl = `${baseUrl}/magic-link?token=${token}`;

    // Get coopId for email (use first shareholder's coop or a default)
    const coopId = user.shareholders[0]?.coopId;
    if (coopId) {
      await this.emailService.sendMagicLink(coopId, email, magicLinkUrl);
    }

    return successMessage;
  }

  async verifyMagicLink(verifyMagicLinkDto: VerifyMagicLinkDto) {
    const { token } = verifyMagicLinkDto;

    // Find and validate token
    const magicLinkToken = await this.prisma.magicLinkToken.findUnique({
      where: { token },
      include: {
        user: {
          include: {
            coopAdminOf: {
              select: { coopId: true },
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

    const user = magicLinkToken.user;
    const coopIds = user.coopAdminOf.map((ca) => ca.coopId);

    // Generate JWT (same as login method)
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      ...(coopIds.length > 0 && { coopIds }),
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        emailVerified: !!user.emailVerified,
      },
    };
  }
}
