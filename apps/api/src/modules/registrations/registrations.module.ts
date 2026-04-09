import { Module, forwardRef } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';
import { DocumentsModule } from '../documents/documents.module';
import { EmailModule } from '../email/email.module';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';

@Module({
  imports: [forwardRef(() => DocumentsModule), EmailModule, AdminNotificationsModule],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
