import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class PontoScheduler {
  private readonly logger = new Logger(PontoScheduler.name);

  constructor(@InjectQueue('ponto') private readonly pontoQueue: Queue) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async handleDailyHealthCheck() {
    this.logger.log('Scheduling daily Ponto connection health check');
    await this.pontoQueue.add('health-check', {});
  }
}
