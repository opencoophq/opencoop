import { Module } from '@nestjs/common';
import { LlmsController } from './llms.controller';

@Module({
  controllers: [LlmsController],
})
export class LlmsModule {}
