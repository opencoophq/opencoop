import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface Audience {
  type: 'ALL' | 'PROJECT' | 'SELECTED';
  projectId?: string | null;
  shareholderIds?: string[];
}

/**
 * The single place that turns an audience into shareholder ids.
 * Used for the live count, the send path and the scheduler. Never sends anything.
 */
@Injectable()
export class AudienceService {
  constructor(private readonly prisma: PrismaService) {}

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
        if (!audience.projectId) throw new BadRequestException('projectId is required for a PROJECT audience');
        const project = await this.prisma.project.findFirst({
          where: { id: audience.projectId, coopId },
          select: { id: true },
        });
        if (!project) throw new NotFoundException('Project not found');
        const regs = await this.prisma.registration.findMany({
          where: {
            coopId,
            projectId: project.id,
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
      default:
        throw new BadRequestException('Unknown audience type');
    }
  }
}
