import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import * as Sentry from '@sentry/nestjs';
import { AudienceSyncService } from './audience-sync.service';

@Processor('audience-sync')
export class AudienceSyncProcessor {
  private readonly logger = new Logger(AudienceSyncProcessor.name);

  constructor(private readonly service: AudienceSyncService) {}

  @Process('reconcile-one')
  async handleReconcileOne(job: Job<{ coopId: string; shareholderId: string }>) {
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('queue', 'audience-sync');
      scope.setTag('job', 'reconcile-one');
      try {
        await this.service.reconcileOne(job.data.coopId, job.data.shareholderId);
      } catch (error) {
        Sentry.captureException(error);
        this.logger.error(`reconcile-one failed: ${(error as Error).message}`);
        throw error; // let Bull retry; nightly reconcile is the backstop
      }
    });
  }

  @Process('reconcile-all')
  async handleReconcileAll(job: Job<{ coopId: string; trigger: 'cron' | 'manual' }>) {
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('queue', 'audience-sync');
      scope.setTag('job', 'reconcile-all');
      try {
        await this.service.reconcileAll(job.data.coopId, job.data.trigger);
      } catch (error) {
        Sentry.captureException(error);
        this.logger.error(
          `reconcile-all failed for ${job.data.coopId}: ${(error as Error).message}`,
        );
        throw error;
      }
    });
  }
}
