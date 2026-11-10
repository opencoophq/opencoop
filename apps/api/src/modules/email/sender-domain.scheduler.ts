import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SenderDomainService } from './sender-domain.service';

@Injectable()
export class SenderDomainScheduler {
  private readonly logger = new Logger(SenderDomainScheduler.name);

  constructor(private readonly senderDomains: SenderDomainService) {}

  /** Re-read Brevo after DNS can change under a domain that was already verified. */
  @Cron('15 4 * * *', { timeZone: 'Europe/Brussels' })
  async nightlyTick(): Promise<void> {
    this.logger.log('Rechecking cooperative sender domains');
    await this.senderDomains.recheckAll();
  }
}
