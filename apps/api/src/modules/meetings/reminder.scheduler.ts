import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class ReminderScheduler {
  private readonly logger = new Logger(ReminderScheduler.name);

  constructor(@InjectQueue('meetings-reminder') private queue: Queue) {}

  @Cron('0 9 * * *', { timeZone: 'Europe/Brussels' })
  async dailyTick() {
    this.logger.log('Enqueuing meetings-reminder tick');
    await this.queue.add('tick', {}, { removeOnComplete: true, removeOnFail: true });
  }
}
