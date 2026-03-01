import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { BankImportService } from './bank-import.service';

@Module({
  imports: [TransactionsModule],
  providers: [BankImportService],
  exports: [BankImportService],
})
export class BankImportModule {}
