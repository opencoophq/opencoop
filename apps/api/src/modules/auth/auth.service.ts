import { Injectable, UnauthorizedException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { CoopsService } from '../coops/coops.service';
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
import * as nodemailer from 'nodemailer';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
    private coopsService: CoopsService,
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
        name: user.name,
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
        name: registerDto.name,
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
        name: user.name,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        emailVerified: false,
      },
    };
  }

  async onboard(onboardingDto: OnboardingDto) {
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

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: onboardingDto.name,
          passwordHash,
          role: 'COOP_ADMIN',
          preferredLanguage: onboardingDto.preferredLanguage || 'nl',
        },
      });

      const coop = await tx.coop.create({
        data: {
          name: onboardingDto.coopName,
          slug: onboardingDto.coopSlug,
          active: false,
          ogmPrefix,
        },
      });

      await tx.coopAdmin.create({
        data: {
          userId: user.id,
          coopId: coop.id,
        },
      });

      return { user, coop };
    });

    const payload = {
      sub: result.user.id,
      email: result.user.email,
      role: result.user.role,
      coopIds: [result.coop.id],
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
        preferredLanguage: result.user.preferredLanguage,
        emailVerified: false,
      },
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
      include: {
        coopAdminOf: {
          include: {
            coop: {
              select: {
                id: true,
                name: true,
                slug: true,
                active: true,
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
            shares: {
              include: {
                shareClass: true,
                project: true,
              },
            },
            transactions: {
              orderBy: { createdAt: 'desc' },
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
    const { passwordHash, emailVerifyToken, passwordResetToken, passwordResetExpires, ...safeUser } = user;

    // SYSTEM_ADMIN can manage all coops, not just ones they're explicitly assigned to
    let adminCoops = user.coopAdminOf.map((ca) => ca.coop);
    if (user.role === 'SYSTEM_ADMIN') {
      const allCoops = await this.prisma.coop.findMany({
        select: { id: true, name: true, slug: true, active: true },
        orderBy: { name: 'asc' },
      });
      adminCoops = allCoops;
    }

    return {
      ...safeUser,
      emailVerified: !!user.emailVerified,
      adminCoops,
      shareholderCoops: user.shareholders.map((s) => s.coop),
    };
  }

  async updateProfile(userId: string, data: { name?: string; preferredLanguage?: string }) {
    return this.usersService.updatePreferences(userId, data);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return { message: 'Password changed successfully' };
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
        name: result.name,
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
    const coopSlug = requestMagicLinkDto.coopSlug;
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

    // Build magic link URL with coop branding if coopSlug is provided
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const magicLinkUrl = coopSlug
      ? `${baseUrl}/${coopSlug}/magic-link?token=${token}`
      : `${baseUrl}/magic-link?token=${token}`;

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
        name: user.name,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        emailVerified: !!user.emailVerified,
      },
    };
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

    // Send confirmation email (don't block or fail the signup)
    this.sendWaitlistConfirmationEmail(waitlistDto.email.toLowerCase(), waitlistDto.locale).catch((err) => {
      console.error('Failed to send waitlist confirmation email:', err.message);
    });

    return { message: 'Successfully joined the waitlist' };
  }

  private getWaitlistEmailContent(locale?: string): { subject: string; heading: string; body: string; closing: string; footer: string } {
    switch (locale) {
      case 'fr':
        return {
          subject: 'Merci pour votre intérêt pour OpenCoop',
          heading: 'Merci pour votre intérêt !',
          body: 'Nous avons bien reçu votre inscription.',
          closing: 'OpenCoop est actuellement en préparation. Nous vous contacterons dès que la plateforme sera disponible.',
          footer: 'Vous recevez cet e-mail car vous vous êtes inscrit(e) sur la liste d\'attente de <a href="https://opencoop.be">opencoop.be</a>.',
        };
      case 'de':
        return {
          subject: 'Vielen Dank für Ihr Interesse an OpenCoop',
          heading: 'Vielen Dank für Ihr Interesse!',
          body: 'Wir haben Ihre Anmeldung erhalten.',
          closing: 'OpenCoop befindet sich derzeit in Vorbereitung. Wir werden Sie kontaktieren, sobald die Plattform verfügbar ist.',
          footer: 'Sie erhalten diese E-Mail, weil Sie sich auf der Warteliste von <a href="https://opencoop.be">opencoop.be</a> eingetragen haben.',
        };
      case 'en':
        return {
          subject: 'Thank you for your interest in OpenCoop',
          heading: 'Thank you for your interest!',
          body: 'We have received your registration.',
          closing: 'OpenCoop is currently being prepared. We will contact you as soon as the platform is available.',
          footer: 'You are receiving this email because you signed up for the waitlist at <a href="https://opencoop.be">opencoop.be</a>.',
        };
      default: // nl
        return {
          subject: 'Bedankt voor je interesse in OpenCoop',
          heading: 'Bedankt voor je interesse!',
          body: 'We hebben je registratie goed ontvangen.',
          closing: 'OpenCoop is momenteel in voorbereiding. We nemen binnenkort contact met je op zodra het platform beschikbaar is.',
          footer: 'Je ontvangt deze e-mail omdat je je hebt ingeschreven op de wachtlijst van <a href="https://opencoop.be">opencoop.be</a>.',
        };
    }
  }

  private getWaitlistClosing(locale?: string): string {
    switch (locale) {
      case 'fr':
        return 'Cordialement,<br>L\'équipe OpenCoop';
      case 'de':
        return 'Mit freundlichen Grüßen,<br>Das OpenCoop-Team';
      case 'en':
        return 'Kind regards,<br>The OpenCoop team';
      default:
        return 'Met vriendelijke groeten,<br>Het OpenCoop team';
    }
  }

  private async sendWaitlistConfirmationEmail(email: string, locale?: string) {
    const host = process.env.SMTP_HOST;
    if (!host) return;

    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || 'OpenCoop <noreply@opencoop.be>';

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });

    const content = this.getWaitlistEmailContent(locale);
    const sign = this.getWaitlistClosing(locale);

    await transporter.sendMail({
      from,
      to: email,
      subject: content.subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
            h1 { color: #1e40af; font-size: 24px; }
            .footer { color: #666; font-size: 12px; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px; }
          </style>
        </head>
        <body>
          <h1>${content.heading}</h1>
          <p>${content.body}</p>
          <p>${content.closing}</p>
          <p>${sign}</p>
          <div class="footer">
            <p>${content.footer}</p>
          </div>
        </body>
        </html>
      `,
    });
  }
}
