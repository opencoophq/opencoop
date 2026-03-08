import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BillingModule } from '../billing/billing.module';
import { PaymentsModule } from '../payments/payments.module';
import { EmailModule } from '../email/email.module';
import { PontoClient } from './ponto.client';
import { PontoService } from './ponto.service';
import { PontoProcessor } from './ponto.processor';
import { PontoScheduler } from './ponto.scheduler';
import { PontoController } from './ponto.controller';
import { PontoAdminController } from './ponto.admin.controller';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ponto' }),
    BillingModule,
    PaymentsModule,
    EmailModule,
  ],
  controllers: [PontoController, PontoAdminController],
  providers: [PontoClient, PontoService, PontoProcessor, PontoScheduler],
  exports: [PontoService],
})
export class PontoModule {}
