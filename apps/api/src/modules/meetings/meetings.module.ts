import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { AgendaService } from './agenda.service';

@Module({
  imports: [EmailModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, AgendaService],
  exports: [MeetingsService, AgendaService],
})
export class MeetingsModule {}
