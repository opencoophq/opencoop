import { Module } from '@nestjs/common';
import { BankImportService } from './bank-import.service';

@Module({
  providers: [BankImportService],
  exports: [BankImportService],
})
export class BankImportModule {}
