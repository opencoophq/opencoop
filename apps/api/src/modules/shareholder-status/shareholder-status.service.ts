import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ShareholderStatus } from '@opencoop/database';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveShareholderStatus } from './shareholder-status';

@Injectable()
export class ShareholderStatusService {
  private readonly logger = new Logger(ShareholderStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('audience-sync') private readonly audienceQueue: Queue,
  ) {}

  async recompute(shareholderId: string): Promise<ShareholderStatus | null> {
    const shareholder = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      select: {
        id: true,
        coopId: true,
        status: true,
        registrations: {
          select: { type: true, status: true, quantity: true },
        },
      },
    });

    if (!shareholder) {
      return null;
    }

    const status = deriveShareholderStatus(shareholder.registrations);
    if (status === shareholder.status) {
      return status;
    }

    await this.prisma.shareholder.update({
      where: { id: shareholder.id },
      data: { status },
    });
    this.logger.log(`Updated shareholder ${shareholder.id} status to ${status}`);

    try {
      await this.audienceQueue.add('reconcile-one', {
        coopId: shareholder.coopId,
        shareholderId: shareholder.id,
      });
    } catch (err) {
      this.logger.warn(
        `audience-sync enqueue failed for ${shareholder.id}: ${(err as Error).message}`,
      );
    }

    return status;
  }

  async recomputeMany(shareholderIds: string[]): Promise<void> {
    for (const shareholderId of new Set(shareholderIds)) {
      await this.recompute(shareholderId);
    }
  }

  async reconcileAll(): Promise<number> {
    const count = await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE shareholders sh SET status = d.status
        FROM (
          SELECT s.id,
            (CASE
              WHEN COALESCE(SUM(CASE WHEN r.type = 'BUY'  AND r.status IN ('ACTIVE','COMPLETED') THEN r.quantity END), 0)
                 - COALESCE(SUM(CASE WHEN r.type = 'SELL' AND r.status = 'COMPLETED' THEN r.quantity END), 0) > 0 THEN 'ACTIVE'
              WHEN COUNT(r.id) FILTER (WHERE r.type = 'BUY' AND r.status IN ('ACTIVE','COMPLETED')) > 0 THEN 'INACTIVE'
              ELSE 'PENDING'
            END)::"ShareholderStatus" AS status
          FROM shareholders s
          LEFT JOIN registrations r ON r."shareholderId" = s.id
          GROUP BY s.id
        ) d
        WHERE d.id = sh.id AND sh.status <> d.status;
      `,
    );
    this.logger.log(`Reconciled ${count} shareholder status(es)`);
    return count;
  }
}
