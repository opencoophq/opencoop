import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { MeetingStatus, ShareholderStatus, Prisma } from '@opencoop/database';
import { randomBytes } from 'crypto';
import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';

function createToken(): string {
  // URL-safe base64 token, 32 bytes of entropy
  return randomBytes(32).toString('base64url');
}

export interface SendConvocationOpts {
  confirmShortNotice?: boolean;
}

export type SendConvocationResult =
  | { alreadySent: true }
  | {
      alreadySent?: false;
      sent: Array<{ to: string; shareholderIds: string[] }>;
      failures: Array<{ to: string; shareholderIds?: string[]; error: string }>;
    };

@Injectable()
export class ConvocationService {
  private readonly logger = new Logger(ConvocationService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  async send(coopId: string, meetingId: string, opts: SendConvocationOpts = {}): Promise<SendConvocationResult> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        coop: true,
        agendaItems: { orderBy: { order: 'asc' }, include: { resolution: true } },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.coopId !== coopId)
      throw new ForbiddenException('Meeting does not belong to this coop');
    if (meeting.status === MeetingStatus.CONVOKED) {
      return { alreadySent: true };
    }

    const daysUntil = (meeting.scheduledAt.getTime() - Date.now()) / (86400 * 1000);
    if (daysUntil < 15 && !opts.confirmShortNotice) {
      throw new BadRequestException(
        `Meeting is less than 15 days away. Set confirmShortNotice=true to override (statuten Art. 22 requires 15 days).`,
      );
    }

    const shareholders = await this.prisma.shareholder.findMany({
      where: { coopId, status: ShareholderStatus.ACTIVE },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        user: { select: { email: true } },
      },
    });

    // Create attendance records and per-shareholder token map first
    const tokenMap = new Map<string, string>();
    const upsertFailedIds = new Set<string>();
    for (const sh of shareholders) {
      try {
        const token = createToken();
        tokenMap.set(sh.id, token);
        await this.prisma.meetingAttendance.upsert({
          where: { meetingId_shareholderId: { meetingId, shareholderId: sh.id } },
          create: {
            meetingId,
            shareholderId: sh.id,
            rsvpToken: token,
            rsvpTokenExpires: meeting.scheduledAt,
          },
          update: {
            rsvpToken: token,
            rsvpTokenExpires: meeting.scheduledAt,
          },
        });
      } catch (err) {
        upsertFailedIds.add(sh.id);
        this.logger.warn(
          `Attendance upsert failed for shareholder ${sh.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Dedupe by resolved email: group shareholders sharing the same inbox
    // Skip shareholders whose upsert failed — their token may be missing and
    // they should not contribute a broken RSVP URL to a household group.
    const inboxMap = new Map<string, typeof shareholders>();
    for (const sh of shareholders) {
      if (upsertFailedIds.has(sh.id)) continue;
      const email = resolveShareholderEmail(sh);
      if (!email) continue; // postal-only: skip
      const group = inboxMap.get(email) ?? [];
      group.push(sh);
      inboxMap.set(email, group);
    }

    // Send one email per distinct inbox
    const sent: Array<{ to: string; shareholderIds: string[] }> = [];
    const failures: Array<{ to: string; shareholderIds?: string[]; error: string }> = [];
    for (const [email, group] of inboxMap) {
      try {
        // Use the first shareholder's token as the RSVP link (primary contact).
        // Guard explicitly: if the token is missing (should not happen after the
        // upsertFailedIds filter above), skip the whole group rather than sending
        // a broken /rsvp/ URL.
        const primaryToken = tokenMap.get(group[0].id);
        if (!primaryToken) {
          this.logger.warn(
            `No RSVP token for primary shareholder ${group[0].id} in inbox group; skipping send`,
          );
          failures.push({
            to: email,
            shareholderIds: group.map((sh) => sh.id),
            error: 'No RSVP token available',
          });
          continue;
        }
        await this.email.send({
          coopId,
          to: email,
          subject: `Oproeping - ${meeting.title}`,
          templateKey: 'meeting-convocation',
          templateData: {
            shareholderName: group
              .map((sh) => `${sh.firstName ?? ''} ${sh.lastName ?? ''}`.trim())
              .filter(Boolean)
              .join(', '),
            meetingTitle: meeting.title,
            meetingDate: meeting.scheduledAt.toISOString(),
            meetingLocation: meeting.location ?? '',
            agendaItems: meeting.agendaItems.map((a) => ({
              order: a.order,
              title: a.title,
              description: a.description,
            })),
            rsvpUrl: `${process.env.NEXT_PUBLIC_WEB_URL ?? 'https://opencoop.be'}/meetings/rsvp/${primaryToken}`,
          },
        });
        sent.push({ to: email, shareholderIds: group.map((sh) => sh.id) });
      } catch (err) {
        failures.push({
          to: email,
          shareholderIds: group.map((sh) => sh.id),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (sent.length > 0) {
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: {
          status: MeetingStatus.CONVOKED,
          convocationSentAt: new Date(),
          convocationFailures: failures.length ? (failures as unknown as Prisma.InputJsonValue) : undefined,
        },
      });
    } else {
      // All sends failed — log clearly so admin knows and can retry
      this.logger.error(
        `Convocation send failed for ALL ${failures.length} recipients on meeting ${meetingId}; not marking CONVOKED to allow retry`,
      );
    }

    return { alreadySent: false, sent, failures };
  }

  async listStatus(coopId: string, meetingId: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { coopId: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.coopId !== coopId) throw new ForbiddenException();

    return this.prisma.meetingAttendance.findMany({
      where: { meetingId },
      include: {
        shareholder: { select: { firstName: true, lastName: true, email: true } },
      },
    });
  }

  async sendReminderNow(coopId: string, meetingId: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { coopId: true, title: true, scheduledAt: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.coopId !== coopId) throw new ForbiddenException();

    const attendances = await this.prisma.meetingAttendance.findMany({
      where: { meetingId, rsvpStatus: 'UNKNOWN' },
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
    });

    // Dedup by inbox: group attendances that resolve to the same email address.
    // A household sharing one inbox must receive a single reminder, not one per shareholder.
    const inboxMap = new Map<string, typeof attendances>();
    for (const att of attendances) {
      const email = resolveShareholderEmail(att.shareholder);
      if (!email) continue; // postal-only: skip
      const group = inboxMap.get(email) ?? [];
      group.push(att);
      inboxMap.set(email, group);
    }

    let sent = 0;
    const failures: Array<{ to: string; error: string }> = [];
    for (const [email, group] of inboxMap) {
      // Use the first attendance's RSVP token (consistent with convocation send()).
      // NOTE: The current meeting-reminder template only supports a single
      // shareholderName string. If the template is later updated to accept a list,
      // pass group.map(a => name(a.shareholder)) instead.
      const primaryAtt = group[0];
      try {
        await this.email.send({
          coopId,
          to: email,
          subject: `Herinnering — ${meeting.title}`,
          templateKey: 'meeting-reminder',
          templateData: {
            shareholderName: `${primaryAtt.shareholder.firstName ?? ''} ${primaryAtt.shareholder.lastName ?? ''}`.trim(),
            meetingTitle: meeting.title,
            meetingDate: meeting.scheduledAt.toISOString(),
            rsvpUrl: `${process.env.NEXT_PUBLIC_WEB_URL ?? 'https://opencoop.be'}/meetings/rsvp/${primaryAtt.rsvpToken}`,
          },
        });
        sent++;
      } catch (err) {
        this.logger.warn(
          `sendReminderNow: failed to send reminder to ${email}: ${err instanceof Error ? err.message : String(err)}`,
        );
        failures.push({ to: email, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { sent, failures };
  }
}
