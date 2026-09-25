import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { AudienceService } from './audience.service';
import { MessagesScheduler } from './messages.scheduler';
import { EmailModule } from '../email/email.module';
import { BillingModule } from '../billing/billing.module';
import { CoopPermissionsService } from '../../common/utils/coop-permissions';

@Module({
  imports: [EmailModule, BillingModule],
  providers: [MessagesService, AudienceService, MessagesScheduler, CoopPermissionsService],
  exports: [MessagesService, AudienceService],
})
export class MessagesModule {}
