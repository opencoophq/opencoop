import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { KioskService } from './kiosk.service';

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

  @Post(':token/search')
  search(@Param('token') token: string, @Body('query') query: string) {
    if (!query || typeof query !== 'string') {
      throw new BadRequestException('query required');
    }
    return this.kiosk.search(token, query);
  }

  @Post(':token/check-in')
  checkIn(
    @Param('token') token: string,
    @Body() body: { shareholderId: string; signaturePngDataUrl: string },
  ) {
    if (!body?.shareholderId || !body?.signaturePngDataUrl) {
      throw new BadRequestException('shareholderId and signaturePngDataUrl required');
    }
    return this.kiosk.checkIn(token, body.shareholderId, body.signaturePngDataUrl);
  }
}
