import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmancipationService, EmancipationReason } from '../auth/emancipation.service';

@Injectable()
export class HouseholdService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private emancipationService: EmancipationService,
  ) {}

  async linkShareholderToUser(args: {
    coopId: string;
    shareholderId: string;
    targetUserId: string;
    actorUserId: string;
  }) {
    const shareholder = await this.prisma.shareholder.findFirst({
      where: { id: args.shareholderId, coopId: args.coopId },
    });

    if (!shareholder) {
      throw new NotFoundException('Shareholder not found');
    }

    // Idempotent re-link: already linked to same user → no-op, return existing
    if (shareholder.userId === args.targetUserId) {
      return shareholder;
    }

    // Already linked to a DIFFERENT user → reject with clear message
    if (shareholder.userId !== null) {
      throw new BadRequestException(
        'Shareholder is already linked to a different user. Emancipate first before re-linking.',
      );
    }

    const targetInCoop = await this.prisma.shareholder.findFirst({
      where: { userId: args.targetUserId, coopId: shareholder.coopId },
      select: { id: true },
    });

    if (!targetInCoop) {
      throw new BadRequestException('Target user is not associated with this cooperative');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.shareholder.update({
        where: { id: args.shareholderId },
        data: { userId: args.targetUserId, email: null },
      });
      await tx.auditLog.create({
        data: {
          coopId: shareholder.coopId,
          entity: 'Shareholder',
          entityId: args.shareholderId,
          action: 'LINK_SHAREHOLDER_TO_HOUSEHOLD',
          actorId: args.actorUserId,
          changes: [
            { field: 'userId', oldValue: shareholder.userId, newValue: u.userId },
            { field: 'email', oldValue: shareholder.email, newValue: null },
          ] as unknown as Prisma.InputJsonValue,
        },
      });
      return u;
    });

    return updated;
  }

  async listShareholdersForUser(userId: string, coopId: string) {
    return this.prisma.shareholder.findMany({
      where: { userId, coopId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Search for users who have at least one shareholder in this coop.
   * Returns user email + count of shareholders, filtered by email prefix.
   */
  async searchUsersInCoop(coopId: string, search: string) {
    if (!search || search.length < 2) return [];

    // Find shareholders with a user whose email matches, grouped by userId
    const rows = await this.prisma.shareholder.findMany({
      where: {
        coopId,
        userId: { not: null },
        user: { email: { contains: search, mode: 'insensitive' } },
      },
      select: {
        userId: true,
        user: { select: { id: true, email: true } },
      },
      distinct: ['userId'],
      take: 10,
    });

    // For each userId, count their shareholders in the coop
    const results = await Promise.all(
      rows.map(async (row) => {
        const count = await this.prisma.shareholder.count({
          where: { coopId, userId: row.userId! },
        });
        return {
          userId: row.user!.id,
          email: row.user!.email,
          shareholderCount: count,
        };
      }),
    );

    return results;
  }

  async unlinkShareholder(args: { coopId: string; shareholderId: string; actorUserId: string }) {
    const shareholder = await this.prisma.shareholder.findFirst({
      where: { id: args.shareholderId, coopId: args.coopId },
    });
    if (!shareholder) {
      throw new NotFoundException('Shareholder not found');
    }
    await this.prisma.auditLog.create({
      data: {
        coopId: shareholder.coopId,
        entity: 'Shareholder',
        entityId: args.shareholderId,
        action: 'UNLINK_SHAREHOLDER_FROM_HOUSEHOLD',
        actorId: args.actorUserId,
        changes: [
          { field: 'userId', oldValue: shareholder.userId, newValue: null },
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    return this.emancipationService.startEmancipation({
      shareholderId: args.shareholderId,
      reason: EmancipationReason.HOUSEHOLD_SPLIT,
    });
  }
}
