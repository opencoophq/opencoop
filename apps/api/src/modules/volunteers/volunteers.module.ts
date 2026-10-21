import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CoopsModule } from '../coops/coops.module';
import { EmailModule } from '../email/email.module';
import { MessagesModule } from '../messages/messages.module';
import { VolunteersAdminController } from './volunteers-admin.controller';
import { VolunteersMemberController } from './volunteers-member.controller';
import { VolunteersPublicController } from './volunteers-public.controller';
import { VolunteersScheduler } from './volunteers.scheduler';
import { VolunteersService } from './volunteers.service';

@Module({
  imports: [EmailModule, BillingModule, MessagesModule, CoopsModule],
  controllers: [VolunteersPublicController, VolunteersMemberController, VolunteersAdminController],
  providers: [VolunteersService, VolunteersScheduler],
  exports: [VolunteersService],
})
export class VolunteersModule {}
