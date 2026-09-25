import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ShareholderStatusScheduler } from './shareholder-status.scheduler';
import { ShareholderStatusService } from './shareholder-status.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'audience-sync' })],
  providers: [ShareholderStatusService, ShareholderStatusScheduler],
  exports: [ShareholderStatusService],
})
export class ShareholderStatusModule {}
