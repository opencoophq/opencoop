import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProxiesService } from './proxies.service';
import { RSVPStatus } from '@opencoop/database';

@Injectable()
export class RsvpService {
  constructor(private prisma: PrismaService, private proxies: ProxiesService) {}

  async resolveToken(token: string) {
    const attendance = await this.prisma.meetingAttendance.findUnique({
      where: { rsvpToken: token },
      include: {
        shareholder: true,
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
          attendance.meetingId,
          attendance.shareholderId,
          delegateShareholderId,
        );
      }
    }

    return this.prisma.meetingAttendance.update({
      where: { id: attendance.id },
      data: { rsvpStatus: status, rsvpAt: new Date() },
    });
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
