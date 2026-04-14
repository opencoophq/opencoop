import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { EmancipationReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';

export { EmancipationReason };

@Injectable()
export class EmancipationService {
  private readonly logger = new Logger(EmancipationService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  /**
   * Create an emancipation token for a shareholder and send the claim email to the
   * appropriate recipient:
   *   - MINOR_COMING_OF_AGE → email goes to registeredBy (parent/guardian)
   *   - HOUSEHOLD_SPLIT     → email goes to the shareholder's linked user (shared inbox)
   */
  async startEmancipation({
    shareholderId,
    reason,
  }: {
    shareholderId: string;
    reason: EmancipationReason;
  }) {
    const shareholder = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      include: {
        registeredBy: true,
        user: true,
        coop: true,
      },
    });

    if (!shareholder) {
      throw new NotFoundException('Shareholder not found');
    }

    if (reason === 'MINOR_COMING_OF_AGE' && shareholder.type !== 'MINOR') {
      throw new BadRequestException('MINOR_COMING_OF_AGE emancipation requires a MINOR shareholder');
    }

    // Resolve the recipient based on the reason
    const recipientUser =
      reason === 'MINOR_COMING_OF_AGE' ? shareholder.registeredBy : shareholder.user;

    const recipientEmail = recipientUser?.email ?? null;

    if (!recipientEmail) {
      throw new BadRequestException(
        reason === 'MINOR_COMING_OF_AGE'
          ? 'No parent/guardian email found for this minor'
          : 'Shareholder has no linked user account to send the claim email to',
      );
    }

    // Generate a plain random token (not hashed — stored as-is, same as upgrade tokens)
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30-day expiry

    // Upsert: replace any previous unused token for this shareholder
    const emancipationToken = await this.prisma.shareholderEmancipationToken.upsert({
      where: { shareholderId },
      create: {
        token,
        shareholderId,
        reason,
        expiresAt,
        recipientUserId: recipientUser?.id ?? null,
      },
      update: {
        token,
        reason,
        expiresAt,
        usedAt: null,
        parentNotifiedAt: null,
        reminderSentAt: null,
        recipientUserId: recipientUser?.id ?? null,
      },
    });

    // Compose the claim URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const claimUrl = `${baseUrl}/emancipate/${token}`;

    // Send the appropriate notification email
    try {
      if (reason === 'MINOR_COMING_OF_AGE') {
        await this.emailService.sendMinorUpgradeNotification(shareholder.coopId, recipientEmail, {
          minorFirstName: shareholder.firstName || '',
          minorLastName: shareholder.lastName || '',
          coopName: shareholder.coop.name,
          upgradeUrl: claimUrl,
        });
      } else {
        await this.emailService.sendEmancipationHouseholdNotification(
          shareholder.coopId,
          recipientEmail,
          {
            shareholderFirstName: shareholder.firstName || '',
            shareholderLastName: shareholder.lastName || '',
            coopName: shareholder.coop.name,
            claimUrl,
          },
        );
      }
    } catch (err) {
      this.logger.error(
        `startEmancipation: failed to send ${reason} email to ${recipientEmail}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException(
        'Emancipation token created but notification email failed to send. Please try again.',
      );
    }

    // Mark as notified
    await this.prisma.shareholderEmancipationToken.update({
      where: { id: emancipationToken.id },
      data: { parentNotifiedAt: new Date() },
    });

    return emancipationToken;
  }

  /**
   * Consume an emancipation token: create a new User account, link it to the shareholder,
   * and mark the token as used — all in a single transaction.
   */
  async consumeEmancipation({
    token,
    email,
    password,
  }: {
    token: string;
    email: string;
    password: string;
  }) {
    const emancipationToken = await this.prisma.shareholderEmancipationToken.findUnique({
      where: { token },
      include: { shareholder: true },
    });

    if (!emancipationToken) {
      throw new NotFoundException('Invalid emancipation token');
    }

    if (emancipationToken.usedAt) {
      throw new BadRequestException('This token has already been used');
    }

    if (emancipationToken.expiresAt < new Date()) {
      throw new BadRequestException('This token has expired');
    }

    // Check if email is already taken
    const existingUser = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('This email address is already registered');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await this.prisma.$transaction(async (tx) => {
      // Create the new user account
      const newUser = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash,
          role: 'SHAREHOLDER',
          preferredLanguage: 'nl',
          emailVerified: new Date(), // auto-verified via token flow
        },
      });

      // Link the shareholder to the new user and populate the email field
      await tx.shareholder.update({
        where: { id: emancipationToken.shareholderId },
        data: {
          userId: newUser.id,
          email: email.toLowerCase(),
        },
      });

      // Mark token as used
      await tx.shareholderEmancipationToken.update({
        where: { id: emancipationToken.id },
        data: { usedAt: new Date() },
      });

      return newUser;
    });

    return { user };
  }
}
