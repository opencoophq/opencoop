import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagesService } from './messages.service';
import { EmailService } from '../email/email.service';

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
        this.logger.error(`Scheduled send failed for ${conv.id} (attempt ${attempts}): ${error.message}`);
        if (attempts >= MAX_ATTEMPTS) {
          await this.prisma.conversation.update({
            where: { id: conv.id },
            data: { status: 'DRAFT', scheduledAt: null, sendAttempts: attempts },
          });
          await this.notifyAdminsOfFailure(conv.coopId, conv.subject, error.message);
        } else {
          await this.prisma.conversation.update({ where: { id: conv.id }, data: { sendAttempts: attempts } });
        }
      }
    }
  }

  private async notifyAdminsOfFailure(coopId: string, subject: string, reason: string) {
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId }, select: { name: true, emailEnabled: true } });
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
