import { Module } from '@nestjs/common';
import { RegistrationsModule } from '../registrations/registrations.module';
import { ShareholderStatusModule } from '../shareholder-status/shareholder-status.module';
import { PaymentsModule } from '../payments/payments.module';
import { OgmModule } from '../ogm/ogm.module';
import { BankImportService } from './bank-import.service';
import { BankMatchingService } from './bank-matching.service';

@Module({
  imports: [RegistrationsModule, ShareholderStatusModule, PaymentsModule, OgmModule],
  providers: [BankImportService, BankMatchingService],
  exports: [BankImportService, BankMatchingService],
})
export class BankImportModule {}
