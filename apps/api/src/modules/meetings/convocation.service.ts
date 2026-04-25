import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailProcessor } from '../email/email.processor';
import { MeetingPdfService } from './pdf.service';
import { MeetingStatus, ShareholderStatus, Prisma } from '@opencoop/database';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';

interface ConvocationTemplateData extends Record<string, unknown> {
  shareholderName: string;
  meetingTitle: string;
  meetingDate: string;
  meetingLocation: string;
  agendaItems: Array<{ order: number; title: string; description: string | null }>;
  rsvpUrl: string;
  customBody?: string;
  language?: string;
}

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
    private emailProcessor: EmailProcessor,
    private pdf: MeetingPdfService,
  ) {}

  /**
   * Generate a per-shareholder convocation PDF and persist it under UPLOAD_DIR
   * so the bull email worker can read it later by path. Idempotent: if the file
   * already exists from a prior send, the buffer is regenerated and overwritten
   * (cheap; ensures the file matches the current meeting state).
   */
  private async writeShareholderPdf(
    coopId: string,
    meetingId: string,
    shareholderId: string,
  ): Promise<string> {
    const buf = await this.pdf.convocation(coopId, meetingId, shareholderId);
    const baseDir = process.env.UPLOAD_DIR || './uploads';
    const dir = path.join(baseDir, 'convocations', meetingId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${shareholderId}.pdf`);
    fs.writeFileSync(filePath, buf);
    return filePath;
  }

  private buildSubject(meeting: { title: string; customSubject: string | null }): string {
    return meeting.customSubject?.trim() || `Oproeping - ${meeting.title}`;
  }

  private buildTemplateData(
    meeting: {
      title: string;
      scheduledAt: Date;
      location: string | null;
      customBody: string | null;
      agendaItems: Array<{ order: number; title: string; description: string | null }>;
    },
    shareholderName: string,
    rsvpToken: string,
  ): ConvocationTemplateData {
    return {
      shareholderName,
      meetingTitle: meeting.title,
      meetingDate: meeting.scheduledAt.toISOString(),
      meetingLocation: meeting.location ?? '',
      agendaItems: meeting.agendaItems.map((a) => ({
        order: a.order,
        title: a.title,
        description: a.description,
      })),
      rsvpUrl: `${process.env.NEXT_PUBLIC_WEB_URL ?? 'https://opencoop.be'}/meetings/rsvp/${rsvpToken}`,
      customBody: meeting.customBody?.trim() || undefined,
    };
  }

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

    const minDays = meeting.coop.minConvocationDays;
    const daysUntil = (meeting.scheduledAt.getTime() - Date.now()) / (86400 * 1000);
    if (daysUntil < minDays && !opts.confirmShortNotice) {
      throw new BadRequestException(
        `Meeting is less than ${minDays} days away (this coop's configured minimum convocation notice). Set confirmShortNotice=true to override.`,
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

    // Look up any existing attendances so we can (a) skip already-sent
    // shareholders and (b) preserve their RSVP token instead of rotating it.
    const existingAttendances = await this.prisma.meetingAttendance.findMany({
      where: { meetingId, shareholderId: { in: shareholders.map((s) => s.id) } },
      select: { shareholderId: true, rsvpToken: true, convocationSentAt: true },
    });
    const attMap = new Map(existingAttendances.map((a) => [a.shareholderId, a]));

    const needsSend = shareholders.filter((sh) => {
      const att = attMap.get(sh.id);
      return !att || att.convocationSentAt === null;
    });

    if (needsSend.length === 0) {
      return { alreadySent: true };
    }

    // For each shareholder needing a send: ensure they have an attendance row
    // with a token. Reuse existing tokens to keep prior emails' RSVP links
    // working; create new attendances for first-time recipients. Use upsert so
    // that two concurrent send() calls don't race on the unique constraint —
    // the second call's `update: {}` is a no-op that preserves the token from
    // whichever call won the create.
    const tokenMap = new Map<string, string>();
    for (const sh of needsSend) {
      const existing = attMap.get(sh.id);
      if (existing) {
        tokenMap.set(sh.id, existing.rsvpToken);
        continue;
      }
      try {
        const token = createToken();
        const row = await this.prisma.meetingAttendance.upsert({
          where: { meetingId_shareholderId: { meetingId, shareholderId: sh.id } },
          create: {
            meetingId,
            shareholderId: sh.id,
            rsvpToken: token,
            rsvpTokenExpires: meeting.scheduledAt,
          },
          update: {}, // no-op: another concurrent send() may have created the row
          select: { rsvpToken: true },
        });
        tokenMap.set(sh.id, row.rsvpToken);
      } catch (err) {
        this.logger.warn(
          `Attendance upsert failed for shareholder ${sh.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Dedupe by resolved email: group shareholders sharing the same inbox.
    // Skip shareholders without a tokenMap entry — their attendance create
    // failed and including them would yield a broken RSVP URL.
    const inboxMap = new Map<string, typeof needsSend>();
    for (const sh of needsSend) {
      if (!tokenMap.has(sh.id)) continue;
      const email = resolveShareholderEmail(sh);
      if (!email) continue; // postal-only: skip
      const group = inboxMap.get(email) ?? [];
      group.push(sh);
      inboxMap.set(email, group);
    }

    const sent: Array<{ to: string; shareholderIds: string[] }> = [];
    const failures: Array<{ to: string; shareholderIds?: string[]; error: string }> = [];
    for (const [email, group] of inboxMap) {
      const primaryToken = tokenMap.get(group[0].id);
      if (!primaryToken) {
        // Defensive: should be unreachable given the tokenMap.has filter above.
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
      try {
        const shareholderName = group
          .map((sh) => `${sh.firstName ?? ''} ${sh.lastName ?? ''}`.trim())
          .filter(Boolean)
          .join(', ');

        // One PDF per shareholder, all attached. Shared-inbox households get
        // an email with multiple attachments — one named copy per family
        // member — so each person has their own personalized convocation.
        const attachments: Array<{ filename: string; path: string }> = [];
        for (const sh of group) {
          try {
            const filePath = await this.writeShareholderPdf(coopId, meetingId, sh.id);
            const safeName = `${sh.firstName ?? ''}-${sh.lastName ?? ''}`
              .trim()
              .replace(/[^a-zA-Z0-9-_]/g, '-')
              .replace(/-+/g, '-');
            const filename = safeName ? `oproeping-${safeName}.pdf` : `oproeping-${sh.id}.pdf`;
            attachments.push({ filename, path: filePath });
          } catch (pdfErr) {
            this.logger.warn(
              `PDF generation failed for shareholder ${sh.id}: ${pdfErr instanceof Error ? pdfErr.message : String(pdfErr)} — sending email without that attachment`,
            );
          }
        }

        await this.email.send({
          coopId,
          to: email,
          subject: this.buildSubject(meeting),
          templateKey: 'meeting-convocation',
          templateData: this.buildTemplateData(meeting, shareholderName, primaryToken),
          attachments: attachments.length ? attachments : undefined,
        });
        // Mark this inbox group as sent. Future send() calls won't re-mail them.
        await this.prisma.meetingAttendance.updateMany({
          where: { meetingId, shareholderId: { in: group.map((sh) => sh.id) } },
          data: { convocationSentAt: new Date() },
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
          convocationSentAt: meeting.convocationSentAt ?? new Date(),
          convocationFailures: failures.length ? (failures as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });
    } else {
      this.logger.error(
        `Convocation send failed for ALL ${failures.length} recipients on meeting ${meetingId}; not marking CONVOKED to allow retry`,
      );
    }

    return { alreadySent: false, sent, failures };
  }

  /**
   * Render the convocation email exactly as a single shareholder would receive
   * it. Used by the admin "preview" UI so admins can verify subject + body
   * before pressing the send button.
   */
  async previewEmail(coopId: string, meetingId: string, shareholderId: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        coop: { select: { name: true } },
        agendaItems: { orderBy: { order: 'asc' } },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.coopId !== coopId) throw new ForbiddenException();

    const sh = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        coopId: true,
        user: { select: { email: true, preferredLanguage: true } },
      },
    });
    if (!sh || sh.coopId !== coopId) throw new NotFoundException('Shareholder not found');

    const recipientEmail = resolveShareholderEmail(sh);
    const shareholderName = `${sh.firstName ?? ''} ${sh.lastName ?? ''}`.trim();
    const sampleToken = 'preview-token-not-real';
    const data = {
      ...this.buildTemplateData(meeting, shareholderName, sampleToken),
      language: sh.user?.preferredLanguage ?? 'nl',
    };

    const html = this.emailProcessor.renderTemplate('meeting-convocation', data, meeting.coop.name);
    return {
      subject: this.buildSubject(meeting),
      html,
      recipientEmail: recipientEmail ?? null,
      shareholderName,
      isPostalOnly: !recipientEmail,
    };
  }

  /**
   * Send the actual convocation email to a single test recipient (typically the
   * admin's own email) so they can verify everything in their own inbox before
   * blasting all shareholders. Bypasses convocationSentAt tracking — does not
   * count as the official convocation send.
   */
  async sendTest(coopId: string, meetingId: string, recipientEmail: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        coop: { select: { name: true } },
        agendaItems: { orderBy: { order: 'asc' } },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.coopId !== coopId) throw new ForbiddenException();
    if (!recipientEmail) throw new BadRequestException('Recipient email required');

    const sampleToken = 'test-' + randomBytes(8).toString('base64url');
    const data = this.buildTemplateData(meeting, 'Test Recipient', sampleToken);

    // For the test, render a PDF using the first active shareholder so the
    // attachment matches what real recipients will see. Skip silently if there
    // are no shareholders yet — the test email still goes out without an
    // attachment so the admin can at least review the body.
    const sampleShareholder = await this.prisma.shareholder.findFirst({
      where: { coopId, status: ShareholderStatus.ACTIVE },
      select: { id: true },
    });
    let attachments: Array<{ filename: string; path: string }> | undefined;
    if (sampleShareholder) {
      try {
        const filePath = await this.writeShareholderPdf(coopId, meetingId, sampleShareholder.id);
        attachments = [{ filename: 'oproeping-test.pdf', path: filePath }];
      } catch (err) {
        this.logger.warn(
          `sendTest: PDF generation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await this.email.send({
      coopId,
      to: recipientEmail,
      subject: `[TEST] ${this.buildSubject(meeting)}`,
      templateKey: 'meeting-convocation',
      templateData: data,
      attachments,
    });

    return { sentTo: recipientEmail };
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
