import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { enqueueReconcileAll } from './audience-sync.queue';

@Injectable()
export class AudienceSyncScheduler {
  private readonly logger = new Logger(AudienceSyncScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('audience-sync') private readonly queue: Queue,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'Europe/Brussels' })
  async nightlyTick() {
    const coops = await this.prisma.coop.findMany({
      where: { emailAudienceProvider: { not: null } },
      select: { id: true },
    });
    this.logger.log(`Enqueuing nightly audience reconcile for ${coops.length} coop(s)`);
    for (const coop of coops) {
      try {
        const result = await enqueueReconcileAll(this.queue, coop.id, 'cron');
        if (result.skipped) {
          this.logger.log(`Nightly audience reconcile already queued for coop ${coop.id}`);
        }
      } catch (error) {
        Sentry.captureException(error);
        this.logger.error(
          `Failed to enqueue audience reconcile for coop ${coop.id}: ${error.message}`,
        );
      }
    }
  }
}
