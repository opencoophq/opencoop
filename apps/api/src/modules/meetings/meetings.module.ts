import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { MeetingsController } from './meetings.controller';
import { MeetingRsvpController } from './meeting-rsvp.controller';
import { MeetingKioskController } from './meeting-kiosk.controller';
import { MeetingsService } from './meetings.service';
import { AgendaService } from './agenda.service';
import { ProxiesService } from './proxies.service';
import { VotesService } from './votes.service';
import { IcsService } from './ics.service';
import { ConvocationService } from './convocation.service';
import { RsvpService } from './rsvp.service';
import { KioskService } from './kiosk.service';

@Module({
  imports: [EmailModule],
  controllers: [MeetingsController, MeetingRsvpController, MeetingKioskController],
  providers: [
    MeetingsService,
    AgendaService,
    ProxiesService,
    VotesService,
    IcsService,
    ConvocationService,
    RsvpService,
    KioskService,
  ],
  exports: [
    MeetingsService,
    AgendaService,
    ProxiesService,
    VotesService,
    IcsService,
    ConvocationService,
    RsvpService,
    KioskService,
  ],
})
export class MeetingsModule {}
