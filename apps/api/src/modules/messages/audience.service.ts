import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { volunteerWhere, VolunteerFilter } from '../volunteers/volunteer-record';

export interface VolunteerRecipient {
  volunteerId: string;
  name: string;
  email: string;
  language: string;
  shareholderId: string | null;
  withdrawToken: string | null;
}

export interface Audience {
  type: 'ALL' | 'PROJECT' | 'SELECTED' | 'DIRECT' | 'VOLUNTEERS';
  projectId?: string | null;
  shareholderIds?: string[];
  shareholderId?: string;
  volunteerFilter?: VolunteerFilter;
}

/**
 * The single place that resolves or counts an audience.
 * Used for live counts, the send path and the scheduler. Never sends anything.
 */
@Injectable()
export class AudienceService {
  constructor(private readonly prisma: PrismaService) {}

  async assertProjectBelongsToCoop(coopId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, coopId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
  }

  async resolve(coopId: string, audience: Audience): Promise<{ shareholderIds: string[] }> {
    switch (audience.type) {
      case 'ALL': {
        const rows = await this.prisma.shareholder.findMany({
          where: { coopId, status: 'ACTIVE' },
          select: { id: true },
        });
        return { shareholderIds: rows.map((r) => r.id) };
      }
      case 'PROJECT': {
        if (!audience.projectId)
          throw new BadRequestException('projectId is required for a PROJECT audience');
        await this.assertProjectBelongsToCoop(coopId, audience.projectId);
        const regs = await this.prisma.registration.findMany({
          where: {
            coopId,
            projectId: audience.projectId,
            type: 'BUY',
            status: { in: ['ACTIVE', 'COMPLETED'] },
            shareholder: { status: 'ACTIVE' },
          },
          select: { shareholderId: true },
        });
        return { shareholderIds: [...new Set(regs.map((r) => r.shareholderId))] };
      }
      case 'SELECTED': {
        const ids = audience.shareholderIds ?? [];
        if (ids.length === 0) return { shareholderIds: [] };
        const rows = await this.prisma.shareholder.findMany({
          where: { coopId, status: 'ACTIVE', id: { in: ids } },
          select: { id: true },
        });
        return { shareholderIds: rows.map((r) => r.id) };
      }
      case 'DIRECT': {
        if (!audience.shareholderId) return { shareholderIds: [] };
        const row = await this.prisma.shareholder.findFirst({
          where: { id: audience.shareholderId, coopId },
          select: { id: true },
        });
        return { shareholderIds: row ? [row.id] : [] };
      }
      case 'VOLUNTEERS': {
        const delivery = await this.resolveVolunteerDelivery(coopId, audience.volunteerFilter);
        return { shareholderIds: delivery.shareholderIds };
      }
      default:
        throw new BadRequestException('Unknown audience type');
    }
  }

  async count(coopId: string, audience: Audience): Promise<number> {
    switch (audience.type) {
      case 'ALL':
        return this.prisma.shareholder.count({
          where: { coopId, status: 'ACTIVE' },
        });
      case 'PROJECT': {
        if (!audience.projectId)
          throw new BadRequestException('projectId is required for a PROJECT audience');
        await this.assertProjectBelongsToCoop(coopId, audience.projectId);
        return this.prisma.shareholder.count({
          where: {
            coopId,
            status: 'ACTIVE',
            registrations: {
              some: {
                coopId,
                projectId: audience.projectId,
                type: 'BUY',
                status: { in: ['ACTIVE', 'COMPLETED'] },
              },
            },
          },
        });
      }
      case 'SELECTED': {
        const ids = audience.shareholderIds ?? [];
        if (ids.length === 0) return 0;
        return this.prisma.shareholder.count({
          where: { coopId, status: 'ACTIVE', id: { in: ids } },
        });
      }
      case 'DIRECT':
        if (!audience.shareholderId) return 0;
        return this.prisma.shareholder.count({
          where: { id: audience.shareholderId, coopId },
        });
      case 'VOLUNTEERS':
        return this.prisma.volunteer.count({
          where: volunteerWhere(coopId, audience.volunteerFilter ?? {}, 'ACTIVE'),
        });
      default:
        throw new BadRequestException('Unknown audience type');
    }
  }

  /**
   * Active volunteers matching the filter. Inbox participants are only the
   * ones linked to an ACTIVE shareholder. The select never loads shareholdings.
   */
  async resolveVolunteerDelivery(
    coopId: string,
    filter: VolunteerFilter = {},
  ): Promise<{ shareholderIds: string[]; recipients: VolunteerRecipient[] }> {
    const rows = await this.prisma.volunteer.findMany({
      where: volunteerWhere(coopId, filter, 'ACTIVE'),
      select: {
        id: true,
        name: true,
        email: true,
        locale: true,
        withdrawToken: true,
        shareholder: {
          select: {
            id: true,
            status: true,
            user: { select: { preferredLanguage: true } },
          },
        },
      },
    });
    const recipients: VolunteerRecipient[] = rows.map((row) => ({
      volunteerId: row.id,
      name: row.name,
      email: row.email,
      language: row.shareholder?.user?.preferredLanguage || row.locale || 'nl',
      shareholderId: row.shareholder?.status === 'ACTIVE' ? row.shareholder.id : null,
      withdrawToken: row.withdrawToken,
    }));
    return {
      shareholderIds: recipients
        .map((recipient) => recipient.shareholderId)
        .filter((id): id is string => Boolean(id)),
      recipients,
    };
  }
}
