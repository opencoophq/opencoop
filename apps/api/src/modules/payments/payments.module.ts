import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { RegistrationsModule } from '../registrations/registrations.module';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
import { ShareholderStatusModule } from '../shareholder-status/shareholder-status.module';

@Module({
  imports: [RegistrationsModule, AdminNotificationsModule, ShareholderStatusModule],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
