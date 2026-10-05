import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { OgmModule } from '../ogm/ogm.module';
import { ChargeCardsController } from './charge-cards.controller';
import { ChargeCardsService } from './charge-cards.service';

@Module({
  imports: [EmailModule, OgmModule],
  controllers: [ChargeCardsController],
  providers: [ChargeCardsService],
})
export class ChargeCardsModule {}
