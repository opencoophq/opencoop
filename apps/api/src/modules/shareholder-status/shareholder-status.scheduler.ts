import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { ShareholderStatusService } from './shareholder-status.service';

@Injectable()
export class ShareholderStatusScheduler {
  private readonly logger = new Logger(ShareholderStatusScheduler.name);

  constructor(private readonly shareholderStatusService: ShareholderStatusService) {}

  @Cron('30 2 * * *', { timeZone: 'Europe/Brussels' })
  async nightlyTick(): Promise<void> {
    try {
      await this.shareholderStatusService.reconcileAll();
    } catch (error) {
      Sentry.captureException(error);
      this.logger.error(`Failed to reconcile shareholder statuses: ${(error as Error).message}`);
    }
  }
}
