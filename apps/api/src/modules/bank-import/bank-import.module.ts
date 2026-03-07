import { Module } from '@nestjs/common';
import { RegistrationsModule } from '../registrations/registrations.module';
import { BankImportService } from './bank-import.service';

@Module({
  imports: [RegistrationsModule],
  providers: [BankImportService],
  exports: [BankImportService],
})
export class BankImportModule {}
