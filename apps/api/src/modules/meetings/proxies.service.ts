import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProxiesService {
  constructor(private prisma: PrismaService) {}

  async create(meetingId: string, grantorShareholderId: string, delegateShareholderId: string) {
    if (grantorShareholderId === delegateShareholderId) {
      throw new BadRequestException('A shareholder cannot delegate to themselves');
    }

    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new NotFoundException('Meeting not found');

    const grantor = await this.prisma.shareholder.findUnique({
      where: { id: grantorShareholderId },
    });
    const delegate = await this.prisma.shareholder.findUnique({
      where: { id: delegateShareholderId },
    });
    if (!grantor || !delegate) throw new NotFoundException('Shareholder not found');
    if (grantor.coopId !== meeting.coopId || delegate.coopId !== meeting.coopId) {
      throw new ForbiddenException('Both shareholders must belong to the meeting coop');
    }

    const activeProxiesHeld = await this.prisma.proxy.count({
      where: {
        meetingId,
        delegateShareholderId,
        revokedAt: null,
      },
    });
    if (activeProxiesHeld >= meeting.maxProxiesPerPerson) {
      throw new BadRequestException(
        `This shareholder has already reached the maximum of ${meeting.maxProxiesPerPerson} proxy(ies) per person`,
      );
    }

    return this.prisma.proxy.create({
      data: { meetingId, grantorShareholderId, delegateShareholderId },
    });
  }

  async list(coopId: string, meetingId: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { coopId: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.coopId !== coopId) {
      throw new ForbiddenException('Meeting does not belong to this coop');
    }

    return this.prisma.proxy.findMany({
      where: { meetingId, revokedAt: null },
      include: { grantor: true, delegate: true },
    });
  }

  async revoke(coopId: string, proxyId: string) {
    const proxy = await this.prisma.proxy.findUnique({
      where: { id: proxyId },
      include: { meeting: { select: { coopId: true } } },
    });
    if (!proxy) throw new NotFoundException('Proxy not found');
    if (proxy.meeting.coopId !== coopId) {
      throw new ForbiddenException('Proxy does not belong to this coop');
    }
    return this.prisma.proxy.update({
      where: { id: proxyId },
      data: { revokedAt: new Date() },
    });
  }

  async attachSignedForm(proxyId: string, signedFormUrl: string) {
    return this.prisma.proxy.update({
      where: { id: proxyId },
      data: { signedFormUrl },
    });
  }
}
