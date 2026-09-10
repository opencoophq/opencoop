import { Module } from '@nestjs/common';
import { RegistrationsModule } from '../registrations/registrations.module';
import { ShareholderStatusModule } from '../shareholder-status/shareholder-status.module';
import { BankImportService } from './bank-import.service';

@Module({
  imports: [RegistrationsModule, ShareholderStatusModule],
  providers: [BankImportService],
  exports: [BankImportService],
})
export class BankImportModule {}
