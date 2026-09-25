import { Module, forwardRef } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';
import { DocumentsModule } from '../documents/documents.module';
import { EmailModule } from '../email/email.module';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
import { ShareholderStatusModule } from '../shareholder-status/shareholder-status.module';

@Module({
  imports: [
    forwardRef(() => DocumentsModule),
    EmailModule,
    AdminNotificationsModule,
    ShareholderStatusModule,
  ],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
