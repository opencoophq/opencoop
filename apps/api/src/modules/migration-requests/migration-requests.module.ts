import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { MigrationRequestsController } from './migration-requests.controller';
import { MigrationRequestsService } from './migration-requests.service';

@Module({
  imports: [EmailModule],
  controllers: [MigrationRequestsController],
  providers: [MigrationRequestsService],
})
export class MigrationRequestsModule {}
