import { Module, forwardRef } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [forwardRef(() => ShareholdersModule), TransactionsModule],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
