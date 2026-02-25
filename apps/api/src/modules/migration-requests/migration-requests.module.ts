import { Module } from '@nestjs/common';
import { MigrationRequestsController } from './migration-requests.controller';
import { MigrationRequestsService } from './migration-requests.service';

@Module({
  controllers: [MigrationRequestsController],
  providers: [MigrationRequestsService],
})
export class MigrationRequestsModule {}
