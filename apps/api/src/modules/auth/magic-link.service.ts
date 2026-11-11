import { Injectable, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuthEmailService } from './auth-email.service';
import { AuditService } from '../audit/audit.service';
import { TokenService } from './token.service';
import { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import { VerifyMagicLinkCodeDto } from './dto/verify-magic-link-code.dto';
import { renderMagicLinkEmail, renderMagicLinkEmailText } from './magic-link-email';
import {
  codesMatch,
  generateCodeSalt,
  generateLoginCode,
  hashLoginCode,
  normalizeLoginCode,
} from './magic-link-code';
import {
  MAGIC_LINK_CODE_EXPIRED,
  MAGIC_LINK_CODE_INVALID,
  MAGIC_LINK_CODE_LOCKED,
  MAGIC_LINK_EMAIL_LIMIT,
  MAGIC_LINK_EMAIL_WINDOW_MS,
  MAGIC_LINK_EXPIRED,
  MAGIC_LINK_INVALID,
  MAGIC_LINK_MAX_CODE_ATTEMPTS,
  MAGIC_LINK_SENT_MESSAGE,
  MAGIC_LINK_TTL_MS,
  MAGIC_LINK_USED,
} from './magic-link.constants';

const USER_INCLUDE = {
  user: {
    include: {
      coopAdminOf: {
        select: {
          coopId: true,
          permissionOverrides: true,
          roles: { select: { role: { select: { permissions: true } } } },
        },
      },
    },
  },
} as const;

// Compared when there is nothing to check, so a missing account does not
// return faster than a real hash compare.
const DUMMY_SALT = 'opencoop-magic-link-dummy-salt';
const DUMMY_HASH = hashLoginCode('000000', DUMMY_SALT).toString('hex');

type MagicLinkRecord = {
  id: string;
  token: string;
  email: string;
  codeHash: string | null;
  codeSalt: string | null;
  failedAttempts: number;
  expiresAt: Date;
  usedAt: Date | null;
  user: {
    id: string;
    email: string;
    mfaEnabled?: boolean;
    coopAdminOf?: unknown;
  };
};

/**
 * Passwordless email sign-in. One row carries both the link and the 6-digit
 * code. Using either one sets `usedAt`, which retires the other. A GET of the
 * link URL never reaches this service: only `verifyMagicLink` (the confirm
 * button) and `verifyMagicLinkCode` consume the row.
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
    const successMessage = { message: MAGIC_LINK_SENT_MESSAGE };

    // Find user by email, or auto-create if a shareholder record exists
    let user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Check if a shareholder exists with this email. If so, auto-create a user account.
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

    // Per email. Per IP is the throttler on the controller route.
    const windowStart = new Date(Date.now() - MAGIC_LINK_EMAIL_WINDOW_MS);
    const recentTokenCount = await this.prisma.magicLinkToken.count({
      where: {
        email,
        createdAt: { gte: windowStart },
        usedAt: null,
      },
    });

    if (recentTokenCount >= MAGIC_LINK_EMAIL_LIMIT) {
      return successMessage;
    }

    const token = randomBytes(32).toString('hex');
    const code = generateLoginCode();
    const codeSalt = generateCodeSalt();
    const codeHash = hashLoginCode(code, codeSalt).toString('hex');
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);

    await this.prisma.magicLinkToken.create({
      data: {
        token,
        userId: user.id,
        email,
        codeHash,
        codeSalt,
        expiresAt,
      },
    });

    // Build magic link URL with coop branding if coopSlug is provided
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const magicLinkUrl = coopSlug
      ? `${baseUrl}/${encodeURIComponent(coopSlug)}/magic-link?token=${token}`
      : `${baseUrl}/magic-link?token=${token}`;

    // Fetch coop branding for the email
    let coopName = 'OpenCoop';
    let brandColor = '#1e40af';
    let coopId: string | undefined;
    if (coopSlug) {
      const channel = await this.prisma.channel.findFirst({
        where: { coop: { slug: coopSlug }, isDefault: true },
        include: { coop: { select: { id: true, name: true } } },
      });
      if (channel) {
        coopName = channel.coop.name;
        coopId = channel.coop.id;
        brandColor = channel.primaryColor;
      }
    }

    const copy = this.authEmail.getMagicLinkContent(user.preferredLanguage, coopName);

    const rendered = { code, magicLinkUrl, brandColor, copy };
    // One mail carries both the login code and the magic link. The log stores
    // the type only; the code and token stay in the message.
    await this.emailService.sendPlatformEmail({
      to: email,
      subject: copy.subject,
      senderName: coopName !== 'OpenCoop' ? coopName : undefined,
      templateKey: 'magic-link',
      coopId,
      html: renderMagicLinkEmail(rendered),
      text: renderMagicLinkEmailText(rendered),
    });

    return successMessage;
  }

  /**
   * Consumes the row. Called only from `POST /auth/magic-link/verify`, which
   * the confirm page fires when the member presses Sign in. There is no GET
   * handler: a scanner prefetch must not land here.
   */
  async verifyMagicLink(verifyMagicLinkDto: VerifyMagicLinkDto, ip?: string, userAgent?: string) {
    const { token } = verifyMagicLinkDto;

    const magicLinkToken = await this.prisma.magicLinkToken.findUnique({
      where: { token },
      include: USER_INCLUDE,
    });

    if (!magicLinkToken) {
      throw new BadRequestException(MAGIC_LINK_INVALID);
    }

    if (magicLinkToken.usedAt) {
      throw new BadRequestException(MAGIC_LINK_USED);
    }

    if (magicLinkToken.expiresAt < new Date()) {
      throw new BadRequestException(MAGIC_LINK_EXPIRED);
    }

    await this.consume(magicLinkToken.id);

    return this.finishLogin(magicLinkToken.user, ip, userAgent, 'magic-link');
  }

  /**
   * Same row as the link. A matching code sets `usedAt`, so the link dies
   * with it. Five mismatches lock the code; the link stays usable.
   */
  async verifyMagicLinkCode(dto: VerifyMagicLinkCodeDto, ip?: string, userAgent?: string) {
    const email = dto.email.toLowerCase();
    const normalized = normalizeLoginCode(dto.code);
    const now = new Date();

    const [latest, unused] = await Promise.all([
      this.prisma.magicLinkToken.findFirst({
        where: { email },
        orderBy: { createdAt: 'desc' },
        include: USER_INCLUDE,
      }),
      this.prisma.magicLinkToken.findMany({
        where: { email, usedAt: null },
        orderBy: { createdAt: 'desc' },
        include: USER_INCLUDE,
      }),
    ]);

    const tokens: MagicLinkRecord[] = [];
    if (latest) tokens.push(latest as MagicLinkRecord);
    for (const row of unused) {
      if (!latest || row.id !== latest.id) tokens.push(row as MagicLinkRecord);
    }

    let matched: MagicLinkRecord | null = null;
    let compared = false;
    for (const candidate of tokens) {
      if (!candidate.codeHash || !candidate.codeSalt) continue;
      compared = true;
      const ok = codesMatch(normalized, candidate.codeSalt, candidate.codeHash);
      if (ok && !matched) matched = candidate;
    }
    if (!compared) {
      codesMatch(normalized, DUMMY_SALT, DUMMY_HASH);
    }

    if (matched) {
      if (matched.usedAt) {
        throw new BadRequestException(MAGIC_LINK_USED);
      }
      if (matched.expiresAt < now) {
        throw new BadRequestException(MAGIC_LINK_CODE_EXPIRED);
      }
      if (matched.failedAttempts >= MAGIC_LINK_MAX_CODE_ATTEMPTS) {
        throw new BadRequestException(MAGIC_LINK_CODE_LOCKED);
      }
      await this.consume(matched.id);
      return this.finishLogin(matched.user, ip, userAgent, 'magic-link-code');
    }

    if (!latest) {
      throw new BadRequestException(MAGIC_LINK_CODE_INVALID);
    }
    if (latest.usedAt) {
      throw new BadRequestException(MAGIC_LINK_USED);
    }
    if (latest.expiresAt < now) {
      throw new BadRequestException(MAGIC_LINK_CODE_EXPIRED);
    }
    if (latest.failedAttempts >= MAGIC_LINK_MAX_CODE_ATTEMPTS || !latest.codeHash) {
      throw new BadRequestException(
        latest.failedAttempts >= MAGIC_LINK_MAX_CODE_ATTEMPTS
          ? MAGIC_LINK_CODE_LOCKED
          : MAGIC_LINK_CODE_INVALID,
      );
    }

    await this.registerFailedAttempt(latest.id);
  }

  private async consume(id: string): Promise<void> {
    const updated = await this.prisma.magicLinkToken.updateMany({
      where: {
        id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    if (updated.count === 0) {
      throw new BadRequestException(MAGIC_LINK_USED);
    }
  }

  /** Increments a wrong guess. The 5th mismatch locks the code. */
  private async registerFailedAttempt(id: string): Promise<never> {
    const updated = await this.prisma.magicLinkToken.updateMany({
      where: {
        id,
        usedAt: null,
        failedAttempts: { lt: MAGIC_LINK_MAX_CODE_ATTEMPTS },
      },
      data: { failedAttempts: { increment: 1 } },
    });

    if (updated.count === 0) {
      throw new BadRequestException(MAGIC_LINK_CODE_LOCKED);
    }

    const fresh = await this.prisma.magicLinkToken.findUnique({
      where: { id },
      select: { failedAttempts: true },
    });
    if (!fresh || fresh.failedAttempts >= MAGIC_LINK_MAX_CODE_ATTEMPTS) {
      throw new BadRequestException(MAGIC_LINK_CODE_LOCKED);
    }
    throw new BadRequestException(MAGIC_LINK_CODE_INVALID);
  }

  private async finishLogin(
    user: MagicLinkRecord['user'],
    ip: string | undefined,
    userAgent: string | undefined,
    method: 'magic-link' | 'magic-link-code',
  ) {
    this.linkOrphanShareholders(user.id, user.email).catch((err) =>
      console.error('Failed to link orphan shareholders:', err.message),
    );

    await this.auditService.log({
      entity: 'Auth',
      entityId: user.id,
      action: 'LOGIN',
      changes: [{ field: 'method', oldValue: null, newValue: method }],
      actorId: user.id,
      ipAddress: ip,
      userAgent,
    });

    return this.tokenService.issueJwtForUser(user as never);
  }

  private async linkOrphanShareholders(userId: string, email: string): Promise<void> {
    await this.prisma.shareholder.updateMany({
      where: { email: { equals: email, mode: 'insensitive' }, userId: null },
      data: { userId },
    });
  }
}
