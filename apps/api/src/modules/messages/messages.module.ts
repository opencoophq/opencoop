import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
