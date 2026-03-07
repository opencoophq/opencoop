import { Module } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';

@Module({
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
