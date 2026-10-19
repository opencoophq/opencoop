import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { VolunteersService } from './volunteers.service';

@Injectable()
export class VolunteersScheduler {
  private readonly logger = new Logger(VolunteersScheduler.name);

  constructor(private readonly volunteers: VolunteersService) {}

  @Cron('15 3 * * *', { timeZone: 'Europe/Brussels' })
  async purgeUnconfirmedSignups(): Promise<void> {
    try {
      await this.volunteers.purgeUnconfirmed(new Date());
    } catch (err) {
      this.logger.error(
        `Failed to purge unconfirmed volunteers: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
