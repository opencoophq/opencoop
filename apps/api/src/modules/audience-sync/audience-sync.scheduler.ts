import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';

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
        await this.queue.add('reconcile-all', { coopId: coop.id, trigger: 'cron' });
      } catch (error) {
        Sentry.captureException(error);
        this.logger.error(
          `Failed to enqueue audience reconcile for coop ${coop.id}: ${error.message}`,
        );
      }
    }
  }
}
