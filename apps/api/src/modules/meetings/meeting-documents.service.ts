import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function uploadDir(): string {
  return process.env.UPLOAD_DIR || './uploads';
}

@Injectable()
export class MeetingDocumentsService {
  constructor(private prisma: PrismaService) {}

  async upload(
    coopId: string,
    meetingId: string,
    file: Express.Multer.File,
    displayName: string | undefined,
    userId: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('No file provided');
    if (file.mimetype !== 'application/pdf') throw new BadRequestException('Only PDF files allowed');
    if (file.size > MAX_FILE_SIZE) throw new BadRequestException('File exceeds 10MB limit');

    await this.assertMeetingInCoop(coopId, meetingId);

    const safeOriginalName = path.basename(file.originalname);
    const effectiveDisplayName = displayName?.trim() || safeOriginalName;

    const existing = await this.prisma.meetingDocument.findFirst({
      where: { meetingId, fileName: effectiveDisplayName },
    });

    const dir = path.join(uploadDir(), 'meeting-documents', meetingId);
    fs.mkdirSync(dir, { recursive: true });
    const storedFilename = `${randomUUID()}.pdf`;
    const relativeUrl = path.posix.join('meeting-documents', meetingId, storedFilename);
    fs.writeFileSync(path.join(dir, storedFilename), file.buffer);

    if (existing) {
      // Replace in place
      const oldAbs = path.join(uploadDir(), existing.fileUrl);
      try {
        fs.unlinkSync(oldAbs);
      } catch (err: unknown) {
        // best-effort; missing file shouldn't block
      }
      return this.prisma.meetingDocument.update({
        where: { id: existing.id },
        data: {
          fileUrl: relativeUrl,
          fileSize: file.size,
          uploadedAt: new Date(),
          uploadedBy: userId,
        },
      });
    }

    const max = await this.prisma.meetingDocument.aggregate({
      where: { meetingId },
      _max: { order: true },
    });
    const nextOrder = (max._max.order ?? -1) + 1;

    return this.prisma.meetingDocument.create({
      data: {
        meetingId,
        fileName: effectiveDisplayName,
        fileUrl: relativeUrl,
        fileSize: file.size,
        order: nextOrder,
        uploadedBy: userId,
      },
    });
  }

  private async assertMeetingInCoop(coopId: string, meetingId: string) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.coopId !== coopId) throw new ForbiddenException('Meeting belongs to different coop');
    return meeting;
  }

  async list(coopId: string, meetingId: string) {
    await this.assertMeetingInCoop(coopId, meetingId);
    return this.prisma.meetingDocument.findMany({
      where: { meetingId },
      orderBy: { order: 'asc' },
    });
  }

  async update(
    coopId: string,
    meetingId: string,
    docId: string,
    patch: { displayName?: string; order?: number },
  ) {
    await this.assertMeetingInCoop(coopId, meetingId);
    const doc = await this.prisma.meetingDocument.findFirst({
      where: { id: docId, meetingId },
    });
    if (!doc) throw new NotFoundException('Document not found in this meeting');

    const data: { fileName?: string; order?: number } = {};
    if (patch.displayName != null) data.fileName = patch.displayName;
    if (patch.order != null) data.order = patch.order;

    return this.prisma.meetingDocument.update({ where: { id: docId }, data });
  }

  async remove(coopId: string, meetingId: string, docId: string) {
    await this.assertMeetingInCoop(coopId, meetingId);
    const doc = await this.prisma.meetingDocument.findFirst({
      where: { id: docId, meetingId },
    });
    if (!doc) throw new NotFoundException('Document not found in this meeting');

    try {
      fs.unlinkSync(path.join(uploadDir(), doc.fileUrl));
    } catch {
      // best-effort; orphan ENOENT is harmless
    }
    await this.prisma.meetingDocument.delete({ where: { id: docId } });
  }

  async getEmailDraft(coopId: string, meetingId: string) {
    const meeting = await this.assertMeetingInCoop(coopId, meetingId);
    const [recipientCount, sentCount, failedCount] = await Promise.all([
      this.prisma.meetingAttendance.count({ where: { meetingId } }),
      this.prisma.meetingAttendance.count({
        where: { meetingId, documentsEmailSentAt: { not: null } },
      }),
      this.prisma.meetingAttendance.count({
        where: { meetingId, documentsEmailError: { not: null } },
      }),
    ]);
    return {
      subject: meeting.documentsSubject,
      intro: meeting.documentsIntro,
      sentAt: meeting.documentsEmailSentAt,
      recipientCount,
      sentCount,
      failedCount,
    };
  }

  async updateEmailDraft(
    coopId: string,
    meetingId: string,
    patch: { subject?: string; intro?: string },
  ) {
    await this.assertMeetingInCoop(coopId, meetingId);
    const data: { documentsSubject?: string; documentsIntro?: string } = {};
    if (patch.subject !== undefined) data.documentsSubject = patch.subject;
    if (patch.intro !== undefined) data.documentsIntro = patch.intro;
    await this.prisma.meeting.update({ where: { id: meetingId }, data });
  }

  async sendEmail(coopId: string, meetingId: string, adminUserId: string) {
    const meeting = await this.assertMeetingInCoop(coopId, meetingId);
    if (meeting.status !== 'CONVOKED') {
      throw new BadRequestException('Meeting must be CONVOKED to send documents');
    }
    const docs = await this.prisma.meetingDocument.findMany({ where: { meetingId } });
    if (docs.length === 0) throw new BadRequestException('No documents to send');

    // Concurrency lock
    if (meeting.documentsEmailSentAt) {
      const ageMs = Date.now() - new Date(meeting.documentsEmailSentAt).getTime();
      if (ageMs < 60_000) {
        throw new BadRequestException('Send already in progress; try again in a minute');
      }
    }

    const isRetry = meeting.documentsEmailSentAt != null;

    if (isRetry) {
      const failedCount = await this.prisma.meetingAttendance.count({
        where: { meetingId, documentsEmailError: { not: null } },
      });
      if (failedCount === 0) throw new BadRequestException('No failed sends to retry');
    }

    const recipients = await this.prisma.meetingAttendance.findMany({
      where: isRetry
        ? { meetingId, documentsEmailError: { not: null } }
        : { meetingId },
    });

    if (isRetry) {
      await this.prisma.meetingAttendance.updateMany({
        where: { id: { in: recipients.map((r) => r.id) } },
        data: { documentsEmailError: null },
      });
    }

    for (const recipient of recipients) {
      await this.enqueueDocumentsEmailJob(meeting, recipient, docs);
    }

    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { documentsEmailSentAt: new Date() },
    });

    return { enqueued: recipients.length };
  }

  protected async enqueueDocumentsEmailJob(
    meeting: { id: string; coopId: string },
    recipient: { id: string; shareholderId: string; rsvpToken: string },
    docs: Array<{ id: string; fileName: string }>,
  ): Promise<void> {
    // Wired to EmailService.queueDocumentsEmail in Task 6 (next).
    // Left abstract here so the service unit-tests can stub it.
    throw new Error('enqueueDocumentsEmailJob must be injected via EmailService');
  }
}
