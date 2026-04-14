import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { AgendaService } from './agenda.service';
import { ProxiesService } from './proxies.service';
import { VotesService } from './votes.service';
import { IcsService } from './ics.service';

@Module({
  imports: [EmailModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, AgendaService, ProxiesService, VotesService, IcsService],
  exports: [MeetingsService, AgendaService, ProxiesService, VotesService, IcsService],
})
export class MeetingsModule {}
