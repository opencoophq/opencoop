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
          // Dedup by inbox: group attendances that resolve to the same email address.
          // A household sharing one inbox must receive a single reminder, not one per shareholder.
          const inboxMap = new Map<string, typeof meeting.attendances>();
          for (const a of meeting.attendances) {
            const email = resolveShareholderEmail(a.shareholder);
            if (!email) continue; // postal-only: skip
            const group = inboxMap.get(email) ?? [];
            group.push(a);
            inboxMap.set(email, group);
          }

          let sent = 0;
          for (const [email, group] of inboxMap) {
            // Use the first attendance's RSVP token (consistent with convocation send()).
            // NOTE: The current meeting-reminder template only supports a single
            // shareholderName string. If the template is later updated to accept a list,
            // pass group.map(a => name(a.shareholder)) instead.
            const primaryA = group[0];
            try {
              await this.email.send({
                coopId: meeting.coopId,
                to: email,
                subject: `Herinnering — ${meeting.title}`,
                templateKey: 'meeting-reminder',
                templateData: {
                  language: 'nl',
                  shareholderName: `${primaryA.shareholder.firstName ?? ''} ${primaryA.shareholder.lastName ?? ''}`.trim(),
                  meetingTitle: meeting.title,
                  meetingDate: meeting.scheduledAt.toISOString(),
                  daysUntil,
                  rsvpUrl: `${process.env.NEXT_PUBLIC_WEB_URL ?? 'https://opencoop.be'}/meetings/rsvp/${primaryA.rsvpToken}`,
                },
              });
              sent++;
            } catch (err) {
              this.logger.warn(`Failed to send reminder to ${primaryA.shareholderId}: ${err}`);
            }
          }
          if (sent === 0 && inboxMap.size > 0) {
            this.logger.warn(
              `All ${inboxMap.size} reminder sends failed for meeting ${meeting.id} (T-${d} days) — NOT marking day as sent; will retry next tick`,
            );
          } else {
            await this.prisma.meeting.update({
              where: { id: meeting.id },
              data: {
                remindersSent: { ...sentMap, [String(d)]: new Date().toISOString() },
              },
            });
            this.logger.log(`Sent ${sent}/${inboxMap.size} reminders for meeting ${meeting.id} (T-${d} days)`);
          }
        }
      }
    }
  }
}
