import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagesService } from './messages.service';
import { EmailService } from '../email/email.service';
import { BillingService } from '../billing/billing.service';
import { CoopPermissionsService, isPermitted } from '../../common/utils/coop-permissions';

const MAX_ATTEMPTS = 3;

/**
 * Every minute: send scheduled conversations whose time has come.
 * MessagesService.send is idempotent (status-guarded), so an overlapping tick
 * or a restart mid-batch cannot send twice.
 */
@Injectable()
export class MessagesScheduler {
  private readonly logger = new Logger(MessagesScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly email: EmailService,
    private readonly billing: BillingService,
    private readonly coopPermissions: CoopPermissionsService,
  ) {}

  @Cron('* * * * *')
  async tick() {
    const scheduledBefore = new Date();
    const due = await this.prisma.conversation.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: scheduledBefore } },
      orderBy: { scheduledAt: 'asc' },
      select: { id: true, coopId: true, createdById: true, subject: true, sendAttempts: true },
    });
    for (const conv of due) {
      const { permissions, role } = await this.coopPermissions.permissionsWithRole(
        conv.createdById,
        conv.coopId,
      );
      let authorizationFailure: string | undefined;
      if (role !== 'SYSTEM_ADMIN') {
        if (await this.billing.isReadOnly(conv.coopId)) {
          authorizationFailure = "the cooperative's subscription is read-only";
        } else if (!isPermitted(permissions, 'canManageMessages')) {
          authorizationFailure = 'the sender no longer has permission to send messages';
        }
      }
      if (authorizationFailure) {
        const reverted = await this.prisma.conversation.updateMany({
          where: { id: conv.id, status: 'SCHEDULED' },
          data: { status: 'DRAFT', scheduledAt: null },
        });
        if (reverted.count === 0) {
          this.logger.warn(
            `Scheduled conversation ${conv.id} was already sent or changed; it was not reverted`,
          );
        } else {
          this.logger.warn(
            `Scheduled conversation ${conv.id} was reverted before send: ${authorizationFailure}`,
          );
          await this.notifyAdminsOfFailure(conv.coopId, conv.subject, authorizationFailure);
        }
        continue;
      }

      try {
        await this.messages.send(
          conv.id,
          conv.coopId,
          { userId: conv.createdById },
          { scheduledBefore },
        );
        this.logger.log(`Sent scheduled conversation ${conv.id}`);
      } catch (error) {
        if (error instanceof ConflictException) {
          this.logger.log(`Scheduled conversation ${conv.id} is no longer due (409); skipping`);
          continue;
        }
        Sentry.captureException(error);
        const attempts = conv.sendAttempts + 1;
        this.logger.error(
          `Scheduled send failed for ${conv.id} (attempt ${attempts}): ${error.message}`,
        );
        if (attempts >= MAX_ATTEMPTS) {
          const reverted = await this.prisma.conversation.updateMany({
            where: { id: conv.id, status: 'SCHEDULED' },
            data: { status: 'DRAFT', scheduledAt: null, sendAttempts: attempts },
          });
          if (reverted.count === 0) {
            this.logger.warn(
              `Scheduled conversation ${conv.id} was already sent or changed; it was not reverted`,
            );
          } else {
            await this.notifyAdminsOfFailure(conv.coopId, conv.subject, error.message);
          }
        } else {
          await this.prisma.conversation.update({
            where: { id: conv.id },
            data: { sendAttempts: attempts },
          });
        }
      }
    }
  }

  private async notifyAdminsOfFailure(coopId: string, subject: string, reason: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: { name: true, emailEnabled: true },
    });
    if (!coop?.emailEnabled) return;
    const admins = await this.prisma.coopAdmin.findMany({
      where: { coopId },
      include: { user: { select: { email: true, name: true } } },
    });
    for (const admin of admins) {
      await this.email.send({
        coopId,
        to: admin.user.email,
        subject: `${coop.name}: Gepland bericht niet verzonden - ${subject}`,
        templateKey: 'admin-message-notification',
        templateData: {
          adminName: admin.user.name || '',
          messageSubject: subject,
          messagePreview: `Het geplande bericht kon niet worden verzonden en staat opnieuw als concept. Reden: ${reason}`,
        },
      });
    }
  }
}
