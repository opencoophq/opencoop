import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ProxiesService } from './proxies.service';
import { IcsService } from './ics.service';
import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';
import { RSVPStatus } from '@opencoop/database';

@Injectable()
export class RsvpService {
  private readonly logger = new Logger(RsvpService.name);

  constructor(
    private prisma: PrismaService,
    private proxies: ProxiesService,
    private email: EmailService,
    private ics: IcsService,
  ) {}

  async resolveToken(token: string) {
    const attendance = await this.prisma.meetingAttendance.findUnique({
      where: { rsvpToken: token },
      include: {
        shareholder: {
          include: {
            user: { select: { email: true, preferredLanguage: true } },
          },
        },
        meeting: {
          include: {
            coop: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                coopEmail: true,
              },
            },
            agendaItems: {
              orderBy: { order: 'asc' },
              include: { resolution: true, attachments: true },
            },
          },
        },
      },
    });
    if (!attendance) throw new NotFoundException('RSVP link invalid or expired');
    if (attendance.rsvpTokenExpires < new Date()) {
      throw new BadRequestException('RSVP link expired');
    }
    return attendance;
  }

  async updateRsvp(token: string, status: RSVPStatus, delegateShareholderId?: string) {
    const attendance = await this.resolveToken(token);

    if (status === RSVPStatus.PROXY) {
      if (!delegateShareholderId) {
        throw new BadRequestException('Delegate required for PROXY RSVP');
      }
      // Idempotent: if a non-revoked proxy already exists for this grantor, skip create.
      const existing = await this.prisma.proxy.findFirst({
        where: {
          meetingId: attendance.meetingId,
          grantorShareholderId: attendance.shareholderId,
          revokedAt: null,
        },
      });
      if (!existing) {
        await this.proxies.create(
          attendance.meeting.coopId,
          attendance.meetingId,
          attendance.shareholderId,
          delegateShareholderId,
        );
      } else if (existing.delegateShareholderId !== delegateShareholderId) {
        // Replace delegate: revoke existing, create new (subject to per-person cap on the new delegate).
        await this.prisma.proxy.update({
          where: { id: existing.id },
          data: { revokedAt: new Date() },
        });
        await this.proxies.create(
          attendance.meeting.coopId,
          attendance.meetingId,
          attendance.shareholderId,
          delegateShareholderId,
        );
      }
    }

    const updated = await this.prisma.meetingAttendance.update({
      where: { id: attendance.id },
      data: { rsvpStatus: status, rsvpAt: new Date() },
    });

    // Fire-and-forget confirmation email. The RSVP itself is already persisted;
    // a failure here (no inbox, ICS write error, queue down) shouldn't roll
    // back the user's response.
    void this.sendConfirmation(attendance, status, delegateShareholderId).catch((err) => {
      this.logger.warn(
        `RSVP confirmation email failed for attendance ${attendance.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return updated;
  }

  /**
   * Send a confirmation email after the shareholder responds. ATTENDING and
   * PROXY get an `.ics` attachment so the meeting lands in their calendar;
   * ABSENT just gets a receipt. Postal-only shareholders are skipped.
   */
  private async sendConfirmation(
    attendance: Awaited<ReturnType<RsvpService['resolveToken']>>,
    status: RSVPStatus,
    delegateShareholderId?: string,
  ) {
    const recipient = resolveShareholderEmail(attendance.shareholder);
    if (!recipient) return; // postal-only — skip

    const language = attendance.shareholder.user?.preferredLanguage ?? 'nl';
    const shareholderName = `${attendance.shareholder.firstName ?? ''} ${attendance.shareholder.lastName ?? ''}`.trim();

    let delegateName = '';
    if (status === RSVPStatus.PROXY && delegateShareholderId) {
      const delegate = await this.prisma.shareholder.findUnique({
        where: { id: delegateShareholderId },
        select: { firstName: true, lastName: true },
      });
      if (delegate) {
        delegateName = `${delegate.firstName ?? ''} ${delegate.lastName ?? ''}`.trim();
      }
    }

    let attachments: Array<{ filename: string; path: string }> | undefined;
    if (status === RSVPStatus.ATTENDING || status === RSVPStatus.PROXY) {
      try {
        const icsPath = this.writeMeetingIcs(attendance.meeting);
        attachments = [{ filename: 'agenda.ics', path: icsPath }];
      } catch (err) {
        this.logger.warn(
          `ICS write failed for meeting ${attendance.meetingId}: ${err instanceof Error ? err.message : String(err)} — sending without attachment`,
        );
      }
    }

    // The default Channel's primaryColor is the brand color; falls back to
    // platform blue so the email isn't unstyled if no default channel exists.
    const defaultChannel = await this.prisma.channel.findFirst({
      where: { coopId: attendance.meeting.coopId, isDefault: true, active: true },
      select: { primaryColor: true },
    });

    await this.email.send({
      coopId: attendance.meeting.coopId,
      to: recipient,
      subject: `${attendance.meeting.coop.name} — ${attendance.meeting.title}`,
      templateKey: 'meeting-rsvp-confirmation',
      templateData: {
        shareholderName,
        meetingTitle: attendance.meeting.title,
        meetingDate: attendance.meeting.scheduledAt.toISOString(),
        meetingLocation: attendance.meeting.location ?? '',
        rsvpStatus: status,
        delegateName,
        rsvpUrl: `${process.env.NEXT_PUBLIC_WEB_URL ?? 'https://opencoop.be'}/meetings/rsvp/${attendance.rsvpToken}`,
        coopName: attendance.meeting.coop.name,
        coopLogoUrl: this.toAbsoluteUrl(attendance.meeting.coop.logoUrl),
        coopPrimaryColor: defaultChannel?.primaryColor ?? undefined,
        language,
      },
      attachments,
    });
  }

  /**
   * Resolve a possibly-relative URL (e.g. `/uploads/logos/x.png` from a
   * local file uploader) to an absolute URL. Email clients (Gmail, Outlook,
   * Apple Mail) won't render `<img src="/path">` because they have no base
   * URL — the message is rendered standalone in the inbox. Always prepend
   * NEXT_PUBLIC_WEB_URL when the input doesn't already include a scheme.
   */
  private toAbsoluteUrl(maybeRelative: string | null | undefined): string {
    if (!maybeRelative) return '';
    if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
    const base = process.env.NEXT_PUBLIC_WEB_URL ?? 'https://opencoop.be';
    return `${base.replace(/\/$/, '')}${maybeRelative.startsWith('/') ? '' : '/'}${maybeRelative}`;
  }

  /**
   * Generate (or refresh) the meeting's `.ics` file under UPLOAD_DIR. The file
   * is identical for every recipient — write once per meeting, reuse on every
   * subsequent RSVP confirmation.
   */
  private writeMeetingIcs(meeting: {
    id: string;
    title: string;
    scheduledAt: Date;
    durationMinutes: number;
    location: string | null;
    agendaItems: Array<{ order: number; title: string }>;
    coop: { name: string; coopEmail: string | null };
  }): string {
    const baseDir = process.env.UPLOAD_DIR || './uploads';
    const dir = path.join(baseDir, 'ics', meeting.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'meeting.ics');
    const content = this.ics.generate({
      uid: `meeting-${meeting.id}@opencoop.be`,
      // Prefix with coop name so it's identifiable in a busy calendar.
      title: `${meeting.coop.name} — ${meeting.title}`,
      start: meeting.scheduledAt,
      durationMinutes: meeting.durationMinutes,
      location: meeting.location ?? '',
      description: meeting.agendaItems
        .map((a) => `${a.order}. ${a.title}`)
        .join('\n'),
      organizerName: meeting.coop.name,
      organizerEmail: meeting.coop.coopEmail ?? 'noreply@opencoop.be',
    });
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  async listEligibleDelegates(token: string) {
    const attendance = await this.resolveToken(token);
    return this.prisma.shareholder.findMany({
      where: {
        coopId: attendance.meeting.coopId,
        status: 'ACTIVE',
        id: { not: attendance.shareholderId },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        memberNumber: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async attachSignedVolmacht(token: string, fileUrl: string) {
    const attendance = await this.resolveToken(token);
    const proxy = await this.prisma.proxy.findFirst({
      where: {
        meetingId: attendance.meetingId,
        grantorShareholderId: attendance.shareholderId,
        revokedAt: null,
      },
    });
    if (!proxy) throw new NotFoundException('No proxy on file for this shareholder');
    return this.prisma.proxy.update({
      where: { id: proxy.id },
      data: { signedFormUrl: fileUrl },
    });
  }
}
