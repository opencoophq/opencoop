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

  async linkShareholders(args: {
    coopId: string;
    shareholderId: string;      // source shareholder (the one being linked into the household)
    targetShareholderId: string; // household anchor shareholder
    actorUserId: string;
  }) {
    if (args.shareholderId === args.targetShareholderId) {
      throw new BadRequestException('Cannot link a shareholder to itself');
    }

    return this.prisma.$transaction(async (tx) => {
      const source = await tx.shareholder.findFirst({
        where: { id: args.shareholderId, coopId: args.coopId },
      });
      if (!source) {
        throw new NotFoundException('Shareholder not found');
      }

      const target = await tx.shareholder.findFirst({
        where: { id: args.targetShareholderId, coopId: args.coopId },
      });
      if (!target) {
        throw new NotFoundException('Target shareholder not found in this cooperative');
      }

      // If source is already linked somewhere, either it's idempotent (same household) or rejected
      if (source.userId !== null) {
        if (target.userId !== null && source.userId === target.userId) {
          return source; // already in same household, no-op
        }
        throw new BadRequestException(
          'Shareholder is already linked to a different user. Emancipate first before re-linking.',
        );
      }

      // Guard: target must have something to anchor a household on
      if (!target.userId && !target.email) {
        throw new BadRequestException(
          'Target shareholder has no email or user account to anchor a household on.',
        );
      }

      let anchorUserId = target.userId;

      // Auto-create a passwordless User from the target shareholder if needed
      if (!anchorUserId) {
        const email = target.email!.toLowerCase(); // guarded above
        const existing = await tx.user.findUnique({ where: { email } });
        let anchorUser = existing;
        if (!anchorUser) {
          anchorUser = await tx.user.create({
            data: {
              email,
              passwordHash: null,
              role: 'SHAREHOLDER',
            },
          });
          await tx.auditLog.create({
            data: {
              coopId: args.coopId,
              entity: 'User',
              entityId: anchorUser.id,
              action: 'CREATE_USER_FROM_SHAREHOLDER',
              actorId: args.actorUserId,
              changes: [
                { field: 'email', oldValue: null, newValue: anchorUser.email },
                { field: 'sourceShareholderId', oldValue: null, newValue: target.id },
              ] as unknown as Prisma.InputJsonValue,
            },
          });
        }
        anchorUserId = anchorUser.id;

        await tx.shareholder.update({
          where: { id: target.id },
          data: { userId: anchorUserId, email: null },
        });
        await tx.auditLog.create({
          data: {
            coopId: args.coopId,
            entity: 'Shareholder',
            entityId: target.id,
            action: 'LINK_SHAREHOLDER_TO_HOUSEHOLD',
            actorId: args.actorUserId,
            changes: [
              { field: 'userId', oldValue: null, newValue: anchorUserId },
              { field: 'email', oldValue: target.email, newValue: null },
            ] as unknown as Prisma.InputJsonValue,
          },
        });
      }

      const updatedSource = await tx.shareholder.update({
        where: { id: source.id },
        data: { userId: anchorUserId, email: null },
      });
      await tx.auditLog.create({
        data: {
          coopId: args.coopId,
          entity: 'Shareholder',
          entityId: source.id,
          action: 'LINK_SHAREHOLDER_TO_HOUSEHOLD',
          actorId: args.actorUserId,
          changes: [
            { field: 'userId', oldValue: source.userId, newValue: anchorUserId },
            { field: 'email', oldValue: source.email, newValue: null },
          ] as unknown as Prisma.InputJsonValue,
        },
      });

      return updatedSource;
    });
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
      // Pre-grouping limit: large households (>20 matches) may undercount shareholderCount. Acceptable per spec trade-off.
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
