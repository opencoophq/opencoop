import { Module } from '@nestjs/common';
import { CoopsController } from './coops.controller';
import { CoopsService } from './coops.service';

@Module({
  controllers: [CoopsController],
  providers: [CoopsService],
  exports: [CoopsService],
})
export class CoopsModule {}
