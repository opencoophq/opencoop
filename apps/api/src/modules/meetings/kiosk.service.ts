import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckInMethod } from '@opencoop/database';
import { randomBytes, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024; // 2MB

@Injectable()
export class KioskService {
  constructor(private prisma: PrismaService) {}

  async startSession(coopId: string, meetingId: string, adminUserId: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { coopId: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.coopId !== coopId) {
      throw new ForbiddenException('Meeting does not belong to this coop');
    }

    return this.prisma.meetingKioskSession.create({
      data: {
        meetingId,
        startedBy: adminUserId,
        token: randomBytes(32).toString('base64url'),
      },
    });
  }

  async endSession(coopId: string, sessionId: string) {
    const session = await this.prisma.meetingKioskSession.findUnique({
      where: { id: sessionId },
      include: { meeting: { select: { coopId: true } } },
    });
    if (!session) throw new NotFoundException('Kiosk session not found');
    if (session.meeting.coopId !== coopId) {
      throw new ForbiddenException('Kiosk session does not belong to this coop');
    }

    return this.prisma.meetingKioskSession.update({
      where: { id: sessionId },
      data: { active: false, endedAt: new Date() },
    });
  }

  async validate(token: string) {
    const session = await this.prisma.meetingKioskSession.findUnique({
      where: { token },
      include: {
        meeting: {
          include: { coop: { select: { name: true, logoUrl: true } } },
        },
      },
    });
    if (!session) throw new NotFoundException('Kiosk session invalid');
    if (!session.active) throw new BadRequestException('Kiosk session ended');
    return session;
  }

  async search(token: string, query: string) {
    const session = await this.validate(token);
    const q = query.trim();
    if (q.length < 2) return [];

    // memberNumber is Int? in the schema — support numeric exact match only.
    const memberNumber = /^\d+$/.test(q) ? Number(q) : undefined;

    const orClauses: any[] = [
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { companyName: { contains: q, mode: 'insensitive' } },
    ];
    if (memberNumber !== undefined) {
      orClauses.push({ memberNumber });
    }

    return this.prisma.shareholder.findMany({
      where: {
        coopId: session.meeting.coopId,
        status: 'ACTIVE',
        OR: orClauses,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        companyName: true,
        memberNumber: true,
        address: true,
      },
      take: 10,
    });
  }

  async checkIn(token: string, shareholderId: string, signaturePngDataUrl: string) {
    const session = await this.validate(token);

    // Enforce tenant isolation: the shareholder must belong to the meeting's coop.
    const shareholder = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      select: { coopId: true },
    });
    if (!shareholder) throw new NotFoundException('Shareholder not found');
    if (shareholder.coopId !== session.meeting.coopId) {
      throw new ForbiddenException('Shareholder does not belong to this meeting coop');
    }

    // Decode the data URL
    const base64 = signaturePngDataUrl.replace(/^data:image\/png;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    if (buf.length === 0) throw new BadRequestException('Empty signature');
    if (buf.length > SIGNATURE_MAX_BYTES) {
      throw new BadRequestException('Signature too large');
    }

    // Save to uploads
    const dir = path.join(UPLOAD_DIR, 'signatures', session.meetingId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filename = `${shareholderId}-${randomUUID()}.png`;
    fs.writeFileSync(path.join(dir, filename), buf);
    const url = `/uploads/signatures/${session.meetingId}/${filename}`;

    // Ensure attendance row exists (walk-ins who were not on the original RSVP list)
    const existing = await this.prisma.meetingAttendance.findUnique({
      where: {
        meetingId_shareholderId: { meetingId: session.meetingId, shareholderId },
      },
    });
    if (!existing) {
      await this.prisma.meetingAttendance.create({
        data: {
          meetingId: session.meetingId,
          shareholderId,
          rsvpToken: randomBytes(32).toString('base64url'),
          rsvpTokenExpires: new Date(session.meeting.scheduledAt),
        },
      });
    }

    return this.prisma.meetingAttendance.update({
      where: {
        meetingId_shareholderId: { meetingId: session.meetingId, shareholderId },
      },
      data: {
        checkedInAt: new Date(),
        checkedInBy: `kiosk:${session.id}`,
        checkInMethod: CheckInMethod.KIOSK,
        signatureImageUrl: url,
      },
    });
  }
}
