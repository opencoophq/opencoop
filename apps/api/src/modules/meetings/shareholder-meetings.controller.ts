import { Controller, Get, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Meetings — Shareholder')
@ApiBearerAuth()
@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class ShareholderMeetingsController {
  constructor(private prisma: PrismaService) {}

  @Get('upcoming')
  async upcoming(@CurrentUser() user: CurrentUserData) {
    const shareholders = await this.prisma.shareholder.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      select: { coopId: true },
    });
    const coopIds = [...new Set(shareholders.map((s) => s.coopId))];
    if (coopIds.length === 0) return [];

    return this.prisma.meeting.findMany({
      where: {
        coopId: { in: coopIds },
        scheduledAt: { gte: new Date() },
        status: { in: ['CONVOKED', 'HELD'] },
      },
      orderBy: { scheduledAt: 'asc' },
      include: { coop: { select: { id: true, name: true, logoUrl: true } } },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    const shareholders = await this.prisma.shareholder.findMany({
      where: { userId: user.id },
      select: { coopId: true },
    });
    const coopIds = [...new Set(shareholders.map((s) => s.coopId))];
    if (coopIds.length === 0) throw new NotFoundException('Meeting not found');

    const meeting = await this.prisma.meeting.findFirst({
      where: {
        id,
        coopId: { in: coopIds },
      },
      include: {
        agendaItems: {
          orderBy: { order: 'asc' },
          include: { resolution: true, attachments: true },
        },
        coop: { select: { id: true, name: true, logoUrl: true } },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }
}
