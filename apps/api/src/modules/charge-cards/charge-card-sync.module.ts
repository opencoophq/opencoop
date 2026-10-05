import { Module } from '@nestjs/common';
import { ChargeCardSyncService } from './charge-card-sync.service';

/** Separate from ChargeCardsModule so ShareholderStatusModule can use it without the controllers and email. */
@Module({
  providers: [ChargeCardSyncService],
  exports: [ChargeCardSyncService],
})
export class ChargeCardSyncModule {}
