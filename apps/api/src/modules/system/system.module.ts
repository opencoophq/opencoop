import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { CoopsModule } from '../coops/coops.module';

@Module({
  imports: [CoopsModule],
  controllers: [SystemController],
})
export class SystemModule {}
