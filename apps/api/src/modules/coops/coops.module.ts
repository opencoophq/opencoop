import { Module } from '@nestjs/common';
import { CoopsController } from './coops.controller';
import { CoopsService } from './coops.service';
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [ShareholdersModule, TransactionsModule],
  controllers: [CoopsController],
  providers: [CoopsService],
  exports: [CoopsService],
})
export class CoopsModule {}
