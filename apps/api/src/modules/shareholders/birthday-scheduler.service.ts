import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class BirthdaySchedulerService {
  private readonly logger = new Logger(BirthdaySchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
    private emailService: EmailService,
  ) {}

  // Run every day at 8:00 AM
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkMinorBirthdays() {
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('cron', 'checkMinorBirthdays');
      await this.handleMinorsTurning18();
      await this.handleMinorsTurning16();
      await this.sendYearlyEmailReminders();
    });
  }

  // ============================================================================
  // MINORS TURNING 18
  // ============================================================================

  private async handleMinorsTurning18() {
    this.logger.log('Checking for minor shareholders turning 18...');

    const today = new Date();
    const eighteenYearsAgo = new Date(
      today.getFullYear() - 18,
      today.getMonth(),
      today.getDate(),
    );

    // Find all minors who have turned 18
    const minorsTurning18 = await this.prisma.shareholder.findMany({
      where: {
        type: 'MINOR',
        birthDate: {
          lte: eighteenYearsAgo,
        },
      },
      include: {
        registeredBy: true,
        coop: true,
        upgradeToken: true,
      },
    });

    this.logger.log(`Found ${minorsTurning18.length} minors who have turned 18`);

    for (const minor of minorsTurning18) {
      try {
        if (minor.email) {
          // Has email address - auto-convert to INDIVIDUAL
          await this.autoConvertToAdult({
            ...minor,
            email: minor.email, // TypeScript narrowing
          });
        } else {
          // No email - use upgrade token flow (if not already done)
          await this.handleMinorWithoutEmail(minor, today);
        }
      } catch (error) {
        Sentry.captureException(error);
        this.logger.error(`Failed to process minor ${minor.id}: ${error.message}`);
      }
    }
  }

  private async autoConvertToAdult(minor: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    coopId: string;
    coop: { name: string };
    registeredBy: { email: string } | null;
  }) {
    this.logger.log(`Auto-converting minor ${minor.firstName} ${minor.lastName} to INDIVIDUAL (has email: ${minor.email})`);

    // Update shareholder type to INDIVIDUAL
    await this.prisma.shareholder.update({
      where: { id: minor.id },
      data: {
        type: 'INDIVIDUAL',
        // Keep registeredByUserId for audit trail, but they now manage their own shares
      },
    });

    // Send notification email to the (now adult) shareholder
    await this.emailService.sendMinorTurnedAdultNotification(
      minor.coopId,
      minor.email,
      {
        firstName: minor.firstName || '',
        lastName: minor.lastName || '',
        coopName: minor.coop.name,
        loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:3002'}/login`,
      },
    );

    // Also notify the parent if available
    if (minor.registeredBy?.email) {
      await this.emailService.sendParentMinorTurnedAdultNotification(
        minor.coopId,
        minor.registeredBy.email,
        {
          minorFirstName: minor.firstName || '',
          minorLastName: minor.lastName || '',
          coopName: minor.coop.name,
        },
      );
    }

    this.logger.log(`Auto-converted ${minor.firstName} ${minor.lastName} to INDIVIDUAL`);
  }

  private async handleMinorWithoutEmail(
    minor: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      coopId: string;
      coop: { name: string };
      registeredBy: { email: string } | null;
      upgradeToken: { usedAt: Date | null; expiresAt: Date } | null;
    },
    today: Date,
  ) {
    // Check if already has a valid, unused token
    if (minor.upgradeToken && !minor.upgradeToken.usedAt && minor.upgradeToken.expiresAt > today) {
      this.logger.log(`Minor ${minor.id} already has active upgrade token, skipping`);
      return;
    }

    // Generate upgrade token
    const token = await this.authService.generateUpgradeToken(minor.id);

    // Get parent's email
    const parentEmail = minor.registeredBy?.email;

    if (!parentEmail) {
      this.logger.warn(`No parent email found for minor ${minor.id} (${minor.firstName} ${minor.lastName})`);
      return;
    }

    // Send notification email to parent
    const upgradeUrl = `${process.env.FRONTEND_URL || 'http://localhost:3002'}/upgrade-to-adult?token=${token}`;
    await this.emailService.sendMinorUpgradeNotification(
      minor.coopId,
      parentEmail,
      {
        minorFirstName: minor.firstName || '',
        minorLastName: minor.lastName || '',
        coopName: minor.coop.name,
        upgradeUrl,
      },
    );

    // Mark token as parent notified
    await this.prisma.minorUpgradeToken.update({
      where: { shareholderId: minor.id },
      data: { parentNotifiedAt: new Date() },
    });

    this.logger.log(`Sent upgrade notification for ${minor.firstName} ${minor.lastName} to ${parentEmail}`);
  }

  // ============================================================================
  // MINORS TURNING 16 - INITIAL EMAIL REMINDER
  // ============================================================================

  private async handleMinorsTurning16() {
    this.logger.log('Checking for minor shareholders turning 16...');

    const today = new Date();
    const sixteenYearsAgo = new Date(
      today.getFullYear() - 16,
      today.getMonth(),
      today.getDate(),
    );
    const seventeenYearsAgo = new Date(
      today.getFullYear() - 17,
      today.getMonth(),
      today.getDate(),
    );

    // Find minors who are 16 (born between 17 and 16 years ago),
    // don't have an email set, and haven't received a reminder yet
    const minorsTurning16 = await this.prisma.shareholder.findMany({
      where: {
        type: 'MINOR',
        birthDate: {
          gt: seventeenYearsAgo, // Younger than 17
          lte: sixteenYearsAgo,  // At least 16
        },
        email: null,
        emailReminderSentAt: null,
      },
      include: {
        registeredBy: true,
        coop: true,
      },
    });

    this.logger.log(`Found ${minorsTurning16.length} minors turning 16 without email`);

    for (const minor of minorsTurning16) {
      try {
        const parentEmail = minor.registeredBy?.email;
        if (!parentEmail) {
          this.logger.warn(`No parent email for minor ${minor.id}`);
          continue;
        }

        await this.emailService.sendSetMinorEmailReminder(
          minor.coopId,
          parentEmail,
          {
            minorFirstName: minor.firstName || '',
            minorLastName: minor.lastName || '',
            coopName: minor.coop.name,
            dashboardUrl: `${process.env.FRONTEND_URL || 'http://localhost:3002'}/dashboard`,
            yearsUntil18: 2,
          },
        );

        await this.prisma.shareholder.update({
          where: { id: minor.id },
          data: { emailReminderSentAt: new Date() },
        });

        this.logger.log(`Sent email setup reminder for ${minor.firstName} ${minor.lastName} to ${parentEmail}`);
      } catch (error) {
        Sentry.captureException(error);
        this.logger.error(`Failed to send reminder for minor ${minor.id}: ${error.message}`);
      }
    }
  }

  // ============================================================================
  // YEARLY EMAIL REMINDERS (16-17 year olds without email)
  // ============================================================================

  private async sendYearlyEmailReminders() {
    this.logger.log('Checking for yearly email reminders...');

    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const eighteenYearsAgo = new Date(
      today.getFullYear() - 18,
      today.getMonth(),
      today.getDate(),
    );
    const sixteenYearsAgo = new Date(
      today.getFullYear() - 16,
      today.getMonth(),
      today.getDate(),
    );

    // Find minors who are 16-17, don't have email, and last reminder was over a year ago
    const minorsNeedingReminder = await this.prisma.shareholder.findMany({
      where: {
        type: 'MINOR',
        birthDate: {
          gt: eighteenYearsAgo,  // Younger than 18
          lte: sixteenYearsAgo,  // At least 16
        },
        email: null,
        emailReminderSentAt: {
          lte: oneYearAgo,
        },
      },
      include: {
        registeredBy: true,
        coop: true,
      },
    });

    this.logger.log(`Found ${minorsNeedingReminder.length} minors needing yearly email reminder`);

    for (const minor of minorsNeedingReminder) {
      try {
        const parentEmail = minor.registeredBy?.email;
        if (!parentEmail) continue;

        // Calculate years until 18
        const birthDate = minor.birthDate!;
        const age = today.getFullYear() - birthDate.getFullYear();
        const yearsUntil18 = 18 - age;

        await this.emailService.sendSetMinorEmailReminder(
          minor.coopId,
          parentEmail,
          {
            minorFirstName: minor.firstName || '',
            minorLastName: minor.lastName || '',
            coopName: minor.coop.name,
            dashboardUrl: `${process.env.FRONTEND_URL || 'http://localhost:3002'}/dashboard`,
            yearsUntil18: yearsUntil18 > 0 ? yearsUntil18 : 1,
          },
        );

        await this.prisma.shareholder.update({
          where: { id: minor.id },
          data: { emailReminderSentAt: new Date() },
        });

        this.logger.log(`Sent yearly email reminder for ${minor.firstName} ${minor.lastName}`);
      } catch (error) {
        Sentry.captureException(error);
        this.logger.error(`Failed to send yearly reminder for minor ${minor.id}: ${error.message}`);
      }
    }
  }

  // ============================================================================
  // UPGRADE TOKEN REMINDERS (for 18+ without email)
  // ============================================================================

  // Send reminder for tokens that haven't been used after 30 days
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendUpgradeTokenReminders() {
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('cron', 'sendUpgradeTokenReminders');
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const tokensNeedingReminder = await this.prisma.minorUpgradeToken.findMany({
        where: {
          usedAt: null,
          parentNotifiedAt: {
            lte: thirtyDaysAgo,
          },
          reminderSentAt: null,
          expiresAt: {
            gt: new Date(), // Token not expired
          },
        },
        include: {
          shareholder: {
            include: {
              registeredBy: true,
              coop: true,
            },
          },
        },
      });

      this.logger.log(`Sending ${tokensNeedingReminder.length} upgrade token reminder emails`);

      for (const tokenRecord of tokensNeedingReminder) {
        try {
          const parentEmail = tokenRecord.shareholder.registeredBy?.email;
          if (!parentEmail) continue;

          const daysRemaining = Math.ceil((tokenRecord.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          const upgradeUrl = `${process.env.FRONTEND_URL || 'http://localhost:3002'}/upgrade-to-adult?token=${tokenRecord.token}`;

          await this.emailService.sendMinorUpgradeReminder(
            tokenRecord.shareholder.coopId,
            parentEmail,
            {
              minorFirstName: tokenRecord.shareholder.firstName || '',
              minorLastName: tokenRecord.shareholder.lastName || '',
              coopName: tokenRecord.shareholder.coop.name,
              upgradeUrl,
              daysRemaining,
            },
          );

          await this.prisma.minorUpgradeToken.update({
            where: { id: tokenRecord.id },
            data: { reminderSentAt: new Date() },
          });
        } catch (error) {
          Sentry.captureException(error);
          this.logger.error(`Failed to send reminder for token ${tokenRecord.id}: ${error.message}`);
        }
      }
    });
  }
}
