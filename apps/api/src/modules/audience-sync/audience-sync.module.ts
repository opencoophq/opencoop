import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { AudienceSyncService } from './audience-sync.service';
import { AudienceSyncProcessor } from './audience-sync.processor';
import { AudienceSyncScheduler } from './audience-sync.scheduler';

@Module({
  imports: [BullModule.registerQueue({ name: 'audience-sync' })],
  providers: [AudienceSyncService, AudienceSyncProcessor, AudienceSyncScheduler],
  exports: [AudienceSyncService, BullModule],
})
export class AudienceSyncModule {}
