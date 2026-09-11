import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { AudienceService } from './audience.service';
import { MessagesScheduler } from './messages.scheduler';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  providers: [MessagesService, AudienceService, MessagesScheduler],
  exports: [MessagesService, AudienceService],
})
export class MessagesModule {}
