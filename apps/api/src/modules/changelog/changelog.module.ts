import { Module } from '@nestjs/common';
import { ChangelogController } from './changelog.controller';

@Module({
  controllers: [ChangelogController],
})
export class ChangelogModule {}
