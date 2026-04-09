import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';

export type AdminNotificationEvent = 'new_shareholder' | 'share_purchase' | 'share_sell' | 'payment_received';

export interface AdminNotificationData {
  shareholderName?: string;
  shareClassName?: string;
  quantity?: number;
  totalAmount?: number;
  paymentAmount?: number;
}

@Injectable()
export class AdminNotificationsService {
  private readonly logger = new Logger(AdminNotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  /**
   * Notify coop admins immediately when an event occurs.
   * Only sends to admins with IMMEDIATE frequency and the relevant toggle enabled.
   */
  async notifyAdminsOnEvent(
    coopId: string,
    event: AdminNotificationEvent,
    data: AdminNotificationData,
  ): Promise<void> {
    try {
      const toggle = this.eventToToggle(event);
      const admins = await this.prisma.coopAdmin.findMany({
        where: {
          coopId,
          notificationSettings: {
            frequency: 'IMMEDIATE',
            [toggle]: true,
          },
        },
        include: {
          user: { select: { email: true, name: true, preferredLanguage: true } },
        },
      });

      if (admins.length === 0) return;

      const coop = await this.prisma.coop.findUnique({
        where: { id: coopId },
        select: { name: true },
      });
      if (!coop) return;

      await Promise.all(
        admins.map((admin) =>
          this.emailService.sendAdminEventNotification(coopId, admin.user.email, {
            adminName: admin.user.name || admin.user.email,
            coopName: coop.name,
            event,
            data,
          }).catch((err) => {
            this.logger.error(`Failed to send admin notification to ${admin.user.email}: ${err.message}`);
          }),
        ),
      );
    } catch (err) {
      this.logger.error(`Failed to send admin event notifications for coop ${coopId}: ${err}`);
    }
  }

  // Run daily digest at 9:00 AM
  @Cron('0 9 * * *')
  async sendDailyDigests(): Promise<void> {
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('cron', 'adminDailyDigests');
      this.logger.log('Sending daily admin notification digests...');
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await this.sendDigests('DAILY', since);
    });
  }

  // Run weekly digest on Monday at 9:00 AM
  @Cron('0 9 * * 1')
  async sendWeeklyDigests(): Promise<void> {
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('cron', 'adminWeeklyDigests');
      this.logger.log('Sending weekly admin notification digests...');
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await this.sendDigests('WEEKLY', since);
    });
  }

  private async sendDigests(frequency: 'DAILY' | 'WEEKLY', since: Date): Promise<void> {
    const adminsWithDigest = await this.prisma.coopAdmin.findMany({
      where: {
        notificationSettings: { frequency },
      },
      include: {
        user: { select: { email: true, name: true } },
        notificationSettings: true,
        coop: { select: { id: true, name: true } },
      },
    });

    for (const admin of adminsWithDigest) {
      const settings = admin.notificationSettings!;
      const events: Array<{ event: AdminNotificationEvent; data: AdminNotificationData }> = [];

      if (settings.notifyOnNewShareholder || settings.notifyOnSharePurchase) {
        const buyRegistrations = await this.prisma.registration.findMany({
          where: { coopId: admin.coopId, type: 'BUY', createdAt: { gte: since } },
          include: {
            shareholder: { select: { firstName: true, lastName: true, companyName: true } },
            shareClass: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

        for (const reg of buyRegistrations) {
          const shareholderName = reg.shareholder.companyName
            || [reg.shareholder.firstName, reg.shareholder.lastName].filter(Boolean).join(' ');

          if (settings.notifyOnNewShareholder) {
            // Check if this shareholder had prior registrations before this one
            const priorCount = await this.prisma.registration.count({
              where: {
                coopId: admin.coopId,
                shareholderId: reg.shareholderId,
                type: 'BUY',
                createdAt: { lt: reg.createdAt },
              },
            });
            if (priorCount === 0) {
              events.push({ event: 'new_shareholder', data: { shareholderName } });
            }
          }

          if (settings.notifyOnSharePurchase) {
            events.push({
              event: 'share_purchase',
              data: { shareholderName, shareClassName: reg.shareClass.name, quantity: reg.quantity, totalAmount: Number(reg.totalAmount) },
            });
          }
        }
      }

      if (settings.notifyOnShareSell) {
        const sellRegistrations = await this.prisma.registration.findMany({
          where: { coopId: admin.coopId, type: 'SELL', createdAt: { gte: since } },
          include: {
            shareholder: { select: { firstName: true, lastName: true, companyName: true } },
            shareClass: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

        for (const reg of sellRegistrations) {
          const shareholderName = reg.shareholder.companyName
            || [reg.shareholder.firstName, reg.shareholder.lastName].filter(Boolean).join(' ');
          events.push({
            event: 'share_sell',
            data: { shareholderName, shareClassName: reg.shareClass.name, quantity: reg.quantity },
          });
        }
      }

      if (settings.notifyOnPaymentReceived) {
        const payments = await this.prisma.payment.findMany({
          where: { coopId: admin.coopId, createdAt: { gte: since } },
          include: {
            registration: {
              include: { shareholder: { select: { firstName: true, lastName: true, companyName: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        for (const payment of payments) {
          const sh = payment.registration.shareholder;
          const shareholderName = sh.companyName || [sh.firstName, sh.lastName].filter(Boolean).join(' ');
          events.push({ event: 'payment_received', data: { shareholderName, paymentAmount: Number(payment.amount) } });
        }
      }

      if (events.length === 0) continue;

      await this.emailService.sendAdminDigest(admin.coopId, admin.user.email, {
        adminName: admin.user.name || admin.user.email,
        coopName: admin.coop.name,
        frequency,
        events,
      }).catch((err) => {
        this.logger.error(`Failed to send ${frequency} digest to ${admin.user.email}: ${err.message}`);
      });
    }
  }

  private eventToToggle(event: AdminNotificationEvent): string {
    const map: Record<AdminNotificationEvent, string> = {
      new_shareholder: 'notifyOnNewShareholder',
      share_purchase: 'notifyOnSharePurchase',
      share_sell: 'notifyOnShareSell',
      payment_received: 'notifyOnPaymentReceived',
    };
    return map[event];
  }
}
