import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { KioskService } from './kiosk.service';
import { KioskCheckInDto } from './dto/kiosk-check-in.dto';

@ApiTags('Public — Kiosk')
@Public()
@Controller('public/meetings/kiosk')
export class MeetingKioskController {
  constructor(private kiosk: KioskService) {}

  @Get(':token')
  async validateKiosk(@Param('token') token: string) {
    const session = await this.kiosk.validate(token);
    return {
      meetingId: session.meetingId,
      meeting: {
        title: session.meeting.title,
        scheduledAt: session.meeting.scheduledAt,
      },
      coop: session.meeting.coop,
    };
  }

  // Lenient throttle: the kiosk runs on a SHARED iPad at the AGM, so all
  // check-in traffic shares one egress IP. A tight per-IP limit would block
  // legitimate members during a check-in burst. 60/min still stops scripted
  // enumeration (which would do hundreds/min) without realistically blocking humans.
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @Post(':token/search')
  search(@Param('token') token: string, @Body('query') query: string) {
    if (!query || typeof query !== 'string') {
      throw new BadRequestException('query required');
    }
    return this.kiosk.search(token, query);
  }

  @Post(':token/check-in')
  checkIn(@Param('token') token: string, @Body() body: KioskCheckInDto) {
    return this.kiosk.checkIn(token, body.shareholderId, body.signaturePngDataUrl);
  }
}
