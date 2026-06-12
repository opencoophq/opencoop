import { Injectable, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuthEmailService } from './auth-email.service';
import { AuditService } from '../audit/audit.service';
import { TokenService } from './token.service';
import { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';

/**
 * Passwordless magic-link login. Extracted from AuthService — issues a
 * single-use login link (auto-provisioning a User from an orphan shareholder
 * when needed, rate-limited, branded per coop) and verifies it, delegating JWT
 * issuance to TokenService. AuthController delegates the magic-link routes here.
 */
@Injectable()
export class MagicLinkService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private authEmail: AuthEmailService,
    private auditService: AuditService,
    private tokenService: TokenService,
  ) {}

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

    return this.tokenService.issueJwtForUser(magicLinkToken.user);
  }

  private async linkOrphanShareholders(userId: string, email: string): Promise<void> {
    await this.prisma.shareholder.updateMany({
      where: { email: { equals: email, mode: 'insensitive' }, userId: null },
      data: { userId },
    });
  }
}
