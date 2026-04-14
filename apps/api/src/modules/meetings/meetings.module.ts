import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EmailModule } from '../email/email.module';
import { MeetingsController } from './meetings.controller';
import { MeetingRsvpController } from './meeting-rsvp.controller';
import { MeetingKioskController } from './meeting-kiosk.controller';
import { ShareholderMeetingsController } from './shareholder-meetings.controller';
import { MeetingsService } from './meetings.service';
import { AgendaService } from './agenda.service';
import { ProxiesService } from './proxies.service';
import { VotesService } from './votes.service';
import { IcsService } from './ics.service';
import { ConvocationService } from './convocation.service';
import { RsvpService } from './rsvp.service';
import { KioskService } from './kiosk.service';
import { AttendanceService } from './attendance.service';
import { MinutesService } from './minutes.service';
import { MeetingPdfService } from './pdf.service';
import { ReminderProcessor } from './reminder.processor';
import { ReminderScheduler } from './reminder.scheduler';

@Module({
  imports: [
    EmailModule,
    BullModule.registerQueue({ name: 'meetings-reminder' }),
  ],
  controllers: [
    MeetingsController,
    MeetingRsvpController,
    MeetingKioskController,
    ShareholderMeetingsController,
  ],
  providers: [
    MeetingsService,
    AgendaService,
    ProxiesService,
    VotesService,
    IcsService,
    ConvocationService,
    RsvpService,
    KioskService,
    AttendanceService,
    MinutesService,
    MeetingPdfService,
    ReminderProcessor,
    ReminderScheduler,
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
    AttendanceService,
    MinutesService,
    MeetingPdfService,
  ],
})
export class MeetingsModule {}
