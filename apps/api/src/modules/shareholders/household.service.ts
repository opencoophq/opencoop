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
   * Search for household-link candidates in this coop by email.
   * Returns one candidate per distinct "household anchor":
   * - user-backed shareholders collapse by userId (shareholderCount = group size)
   * - userless shareholders are returned individually (shareholderCount = 1)
   *
   * Excludes the source shareholder. Excludes shareholders with no resolvable email
   * (neither shareholder.email nor user.email is set).
   */
  async searchHouseholdCandidates(
    coopId: string,
    sourceShareholderId: string,
    search: string,
  ): Promise<
    Array<{
      shareholderId: string;
      email: string;
      fullName: string;
      shareholderCount: number;
    }>
  > {
    if (!search || search.length < 2) return [];

    const rows = await this.prisma.shareholder.findMany({
      where: {
        coopId,
        id: { not: sourceShareholderId },
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        companyName: true,
        email: true,
        userId: true,
        user: { select: { id: true, email: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const displayName = (row: (typeof rows)[number]): string => {
      if (row.firstName && row.lastName) return `${row.firstName} ${row.lastName}`;
      if (row.companyName) return row.companyName;
      return row.email ?? row.user?.email ?? '';
    };

    const byUserId = new Map<string, typeof rows>();
    const userless: typeof rows = [];
    for (const row of rows) {
      if (row.userId) {
        const group = byUserId.get(row.userId) ?? [];
        group.push(row);
        byUserId.set(row.userId, group);
      } else {
        userless.push(row);
      }
    }

    const candidates: Array<{
      shareholderId: string;
      email: string;
      fullName: string;
      shareholderCount: number;
      anchorCreatedAt: Date;
    }> = [];

    for (const group of byUserId.values()) {
      const anchor = group[0]; // earliest createdAt — rows are pre-sorted ASC
      const email = anchor.user?.email ?? anchor.email;
      if (!email) continue;
      candidates.push({
        shareholderId: anchor.id,
        email,
        fullName: displayName(anchor),
        shareholderCount: group.length,
        anchorCreatedAt: anchor.createdAt,
      });
    }
    for (const row of userless) {
      const email = row.email;
      if (!email) continue;
      candidates.push({
        shareholderId: row.id,
        email,
        fullName: displayName(row),
        shareholderCount: 1,
        anchorCreatedAt: row.createdAt,
      });
    }

    candidates.sort((a, b) => a.anchorCreatedAt.getTime() - b.anchorCreatedAt.getTime());

    return candidates.slice(0, 10).map(({ anchorCreatedAt: _unused, ...rest }) => rest);
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
