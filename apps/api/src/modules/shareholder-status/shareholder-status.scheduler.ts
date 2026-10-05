import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { ChargeCardSyncService } from '../charge-cards/charge-card-sync.service';
import { ShareholderStatusService } from './shareholder-status.service';

@Injectable()
export class ShareholderStatusScheduler {
  private readonly logger = new Logger(ShareholderStatusScheduler.name);

  constructor(
    private readonly shareholderStatusService: ShareholderStatusService,
    private readonly chargeCardSync: ChargeCardSyncService,
  ) {}

  @Cron('30 2 * * *', { timeZone: 'Europe/Brussels' })
  async nightlyTick(): Promise<void> {
    try {
      await this.shareholderStatusService.reconcileAll();
    } catch (error) {
      Sentry.captureException(error);
      this.logger.error(`Failed to reconcile shareholder statuses: ${(error as Error).message}`);
    }

    // After the reconcile, so cards follow tonight's statuses. Runs even if the
    // reconcile failed: card state then follows the statuses already stored.
    try {
      await this.chargeCardSync.syncAll();
    } catch (error) {
      Sentry.captureException(error);
      this.logger.error(`Failed to sync charge cards: ${(error as Error).message}`);
    }
  }
}
