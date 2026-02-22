import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';

@Module({
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
