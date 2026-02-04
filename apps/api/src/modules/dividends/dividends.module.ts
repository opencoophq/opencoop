import { Module } from '@nestjs/common';
import { DividendsService } from './dividends.service';

@Module({
  providers: [DividendsService],
  exports: [DividendsService],
})
export class DividendsModule {}
