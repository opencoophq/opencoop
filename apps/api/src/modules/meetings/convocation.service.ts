import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { MeetingStatus, ShareholderStatus } from '@opencoop/database';
import { randomBytes } from 'crypto';

function createToken(): string {
  // URL-safe base64 token, 32 bytes of entropy
  return randomBytes(32).toString('base64url');
}

export interface SendConvocationOpts {
  confirmShortNotice?: boolean;
}

@Injectable()
export class ConvocationService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  async send(coopId: string, meetingId: string, opts: SendConvocationOpts = {}) {
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
      return { alreadySent: true as const };
    }

    const daysUntil = (meeting.scheduledAt.getTime() - Date.now()) / (86400 * 1000);
    if (daysUntil < 15 && !opts.confirmShortNotice) {
      throw new BadRequestException(
        `Meeting is less than 15 days away. Set confirmShortNotice=true to override (statuten Art. 22 requires 15 days).`,
      );
    }

    const shareholders = await this.prisma.shareholder.findMany({
      where: { coopId, status: ShareholderStatus.ACTIVE },
    });

    const failures: Array<{ shareholderId: string; error: string }> = [];
    for (const sh of shareholders) {
      try {
        const token = createToken();
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
        if (sh.email) {
          await this.email.send({
            coopId,
            to: sh.email,
            subject: `Oproeping - ${meeting.title}`,
            templateKey: 'meeting-convocation',
            templateData: {
              shareholderName: `${sh.firstName ?? ''} ${sh.lastName ?? ''}`.trim(),
              meetingTitle: meeting.title,
              meetingDate: meeting.scheduledAt.toISOString(),
              meetingLocation: meeting.location ?? '',
              agendaItems: meeting.agendaItems.map((a) => ({
                order: a.order,
                title: a.title,
                description: a.description,
              })),
              rsvpUrl: `${process.env.NEXT_PUBLIC_WEB_URL ?? 'https://opencoop.be'}/meetings/rsvp/${token}`,
            },
          });
        }
      } catch (err) {
        failures.push({
          shareholderId: sh.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return this.prisma.meeting.update({
      where: { id: meetingId },
      data: {
        status: MeetingStatus.CONVOKED,
        convocationSentAt: new Date(),
        convocationFailures: failures.length ? (failures as any) : undefined,
      },
    });
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
}
