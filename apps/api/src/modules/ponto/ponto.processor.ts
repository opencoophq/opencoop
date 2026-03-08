import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import * as Sentry from '@sentry/nestjs';
import { PontoService } from './ponto.service';

@Processor('ponto')
export class PontoProcessor {
  private readonly logger = new Logger(PontoProcessor.name);

  constructor(private readonly pontoService: PontoService) {}

  @Process('process-transactions')
  async handleProcessTransactions(
    job: Job<{ synchronizationId: string; accountId: string }>,
  ) {
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('queue', 'ponto');
      scope.setTag('job', 'process-transactions');

      const { synchronizationId, accountId } = job.data;

      this.logger.log(
        `Processing transactions for sync ${synchronizationId}, account ${accountId}`,
      );

      try {
        await this.pontoService.processNewTransactions(synchronizationId, accountId);
        this.logger.log(
          `Successfully processed transactions for sync ${synchronizationId}`,
        );
      } catch (error) {
        Sentry.captureException(error);
        this.logger.error(
          `Failed to process transactions for sync ${synchronizationId}: ${error.message}`,
        );
        throw error;
      }
    });
  }

  @Process('health-check')
  async handleHealthCheck() {
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('queue', 'ponto');
      scope.setTag('job', 'health-check');

      this.logger.log('Running Ponto connection health check');

      try {
        await this.pontoService.checkConnectionHealth();
        this.logger.log('Ponto connection health check completed');
      } catch (error) {
        Sentry.captureException(error);
        this.logger.error(`Ponto health check failed: ${error.message}`);
        throw error;
      }
    });
  }
}
