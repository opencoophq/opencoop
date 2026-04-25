import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MeetingStatus } from '@opencoop/database';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';

@Injectable()
export class MeetingsService {
  constructor(private prisma: PrismaService) {}

  async create(coopId: string, dto: CreateMeetingDto) {
    return this.prisma.meeting.create({
      data: {
        coopId,
        type: dto.type,
        title: dto.title,
        scheduledAt: new Date(dto.scheduledAt),
        durationMinutes: dto.durationMinutes ?? 120,
        location: dto.location,
        format: dto.format,
        votingWeight: dto.votingWeight ?? 'PER_SHAREHOLDER',
        maxProxiesPerPerson: dto.maxProxiesPerPerson ?? 1,
        reminderDaysBefore: dto.reminderDaysBefore ?? [3],
        customSubject: dto.customSubject ?? undefined,
        customBody: dto.customBody ?? undefined,
      },
    });
  }

  async list(coopId: string) {
    return this.prisma.meeting.findMany({
      where: { coopId },
      orderBy: { scheduledAt: 'desc' },
      include: {
        agendaItems: { orderBy: { order: 'asc' } },
        _count: { select: { attendances: true, proxies: true } },
      },
    });
  }

  async get(coopId: string, id: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id, coopId },
      include: {
        coop: { select: { minConvocationDays: true } },
        agendaItems: {
          orderBy: { order: 'asc' },
          include: { resolution: true, attachments: true },
        },
        // Only include attendances where the shareholder has actually
        // responded — the "RSVPs" counter on the admin overview should
        // reflect responses, not "everyone who got the convocation".
        attendances: {
          where: { rsvpStatus: { not: 'UNKNOWN' } },
          select: {
            id: true,
            shareholderId: true,
            rsvpStatus: true,
            rsvpAt: true,
          },
        },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  async update(coopId: string, id: string, dto: UpdateMeetingDto) {
    await this.get(coopId, id);
    return this.prisma.meeting.update({
      where: { id },
      data: {
        ...dto,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
      },
    });
  }

  async delete(coopId: string, id: string) {
    const meeting = await this.get(coopId, id);
    if (meeting.status !== MeetingStatus.DRAFT) {
      throw new ForbiddenException(
        'Can only delete meetings in DRAFT status. Use cancel() instead.',
      );
    }
    return this.prisma.meeting.delete({ where: { id } });
  }

  async cancel(coopId: string, id: string, _reason: string) {
    await this.get(coopId, id);
    return this.prisma.meeting.update({
      where: { id },
      data: { status: MeetingStatus.CANCELLED },
    });
  }
}
