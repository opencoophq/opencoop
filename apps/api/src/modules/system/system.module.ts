import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { CoopsModule } from '../coops/coops.module';
import { BillingModule } from '../billing/billing.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [CoopsModule, BillingModule, AuditModule],
  controllers: [SystemController],
})
export class SystemModule {}
