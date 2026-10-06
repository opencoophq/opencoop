import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { EmailModule } from '../email/email.module';
import { OgmModule } from '../ogm/ogm.module';
import { ChargeCardsController } from './charge-cards.controller';
import { ChargeCardsService } from './charge-cards.service';
import { ChargeCardsAdminController } from './charge-cards-admin.controller';
import { ChargeCardsAdminService } from './charge-cards-admin.service';

@Module({
  imports: [EmailModule, OgmModule, BillingModule],
  controllers: [ChargeCardsController, ChargeCardsAdminController],
  providers: [ChargeCardsService, ChargeCardsAdminService],
})
export class ChargeCardsModule {}
