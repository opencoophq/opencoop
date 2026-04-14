import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckInMethod } from '@opencoop/database';

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  private async assertMeetingInCoop(meetingId: string, coopId: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { coopId: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.coopId !== coopId) {
      throw new ForbiddenException('Meeting does not belong to this coop');
    }
  }

  async checkIn(
    coopId: string,
    meetingId: string,
    shareholderId: string,
    adminUserId: string,
  ) {
    await this.assertMeetingInCoop(meetingId, coopId);
    const attendance = await this.prisma.meetingAttendance.findUnique({
      where: { meetingId_shareholderId: { meetingId, shareholderId } },
    });
    if (!attendance) {
      throw new NotFoundException('Shareholder is not on the attendance list');
    }
    return this.prisma.meetingAttendance.update({
      where: { id: attendance.id },
      data: {
        checkedInAt: new Date(),
        checkedInBy: adminUserId,
        checkInMethod: CheckInMethod.ADMIN,
      },
    });
  }

  async undo(coopId: string, meetingId: string, shareholderId: string) {
    await this.assertMeetingInCoop(meetingId, coopId);
    return this.prisma.meetingAttendance.update({
      where: { meetingId_shareholderId: { meetingId, shareholderId } },
      data: {
        checkedInAt: null,
        checkedInBy: null,
        checkInMethod: null,
        signatureImageUrl: null,
      },
    });
  }

  async liveState(coopId: string, meetingId: string) {
    await this.assertMeetingInCoop(meetingId, coopId);
    const [rsvpCount, checkedInCount, proxyCount, totalEligible] = await Promise.all([
      this.prisma.meetingAttendance.count({
        where: { meetingId, rsvpStatus: 'ATTENDING' },
      }),
      this.prisma.meetingAttendance.count({
        where: { meetingId, checkedInAt: { not: null } },
      }),
      this.prisma.proxy.count({ where: { meetingId, revokedAt: null } }),
      this.prisma.meetingAttendance.count({ where: { meetingId } }),
    ]);
    return { rsvpCount, checkedInCount, proxyCount, totalEligible };
  }

  async list(coopId: string, meetingId: string) {
    await this.assertMeetingInCoop(meetingId, coopId);
    return this.prisma.meetingAttendance.findMany({
      where: { meetingId },
      include: {
        shareholder: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            memberNumber: true,
            email: true,
          },
        },
      },
      orderBy: [
        { shareholder: { lastName: 'asc' } },
        { shareholder: { firstName: 'asc' } },
      ],
    });
  }
}
