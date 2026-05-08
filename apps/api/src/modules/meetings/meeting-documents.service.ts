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
}
