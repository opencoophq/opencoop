import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { AgendaService } from './agenda.service';
import { ProxiesService } from './proxies.service';

@Module({
  imports: [EmailModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, AgendaService, ProxiesService],
  exports: [MeetingsService, AgendaService, ProxiesService],
})
export class MeetingsModule {}
