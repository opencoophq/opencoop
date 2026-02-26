import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { CoopsModule } from '../coops/coops.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [CoopsModule, BillingModule],
  controllers: [SystemController],
})
export class SystemModule {}
