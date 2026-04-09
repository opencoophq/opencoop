import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { RegistrationsModule } from '../registrations/registrations.module';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';

@Module({
  imports: [RegistrationsModule, AdminNotificationsModule],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
