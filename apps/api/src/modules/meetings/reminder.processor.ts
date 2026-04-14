import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { MeetingStatus, RSVPStatus } from '@opencoop/database';
import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';

@Processor('meetings-reminder')
export class ReminderProcessor {
  private logger = new Logger(ReminderProcessor.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  @Process('tick')
  async tick() {
    const meetings = await this.prisma.meeting.findMany({
      where: { status: MeetingStatus.CONVOKED },
      include: {
        coop: true,
        attendances: {
          where: { rsvpStatus: RSVPStatus.UNKNOWN },
          include: {
            shareholder: {
              select: {
                email: true,
                firstName: true,
                lastName: true,
                user: { select: { email: true } },
              },
            },
          },
        },
      },
    });

    const now = new Date();
    for (const meeting of meetings) {
      const daysUntil = Math.ceil(
        (meeting.scheduledAt.getTime() - now.getTime()) / (86400 * 1000),
      );
      if (daysUntil < 0) continue;

      const sentMap = (meeting.remindersSent as Record<string, string> | null) ?? {};

      for (const d of meeting.reminderDaysBefore) {
        if (d === daysUntil && !sentMap[String(d)]) {
          let sent = 0;
          for (const a of meeting.attendances) {
            const email = resolveShareholderEmail(a.shareholder);
            if (!email) continue;
            try {
              await this.email.send({
                coopId: meeting.coopId,
                to: email,
                subject: `Herinnering — ${meeting.title}`,
                templateKey: 'meeting-reminder',
                templateData: {
                  language: 'nl',
                  shareholderName: `${a.shareholder.firstName ?? ''} ${a.shareholder.lastName ?? ''}`.trim(),
                  meetingTitle: meeting.title,
                  meetingDate: meeting.scheduledAt.toISOString(),
                  daysUntil,
                  rsvpUrl: `${process.env.NEXT_PUBLIC_WEB_URL ?? 'https://opencoop.be'}/meetings/rsvp/${a.rsvpToken}`,
                },
              });
              sent++;
            } catch (err) {
              this.logger.warn(`Failed to send reminder to ${a.shareholderId}: ${err}`);
            }
          }
          await this.prisma.meeting.update({
            where: { id: meeting.id },
            data: {
              remindersSent: { ...sentMap, [String(d)]: new Date().toISOString() },
            },
          });
          this.logger.log(`Sent ${sent} reminders for meeting ${meeting.id} (T-${d} days)`);
        }
      }
    }
  }
}
