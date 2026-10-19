import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { VolunteersService } from './volunteers.service';
import { PublicVolunteerSignupDto, VolunteerTokenDto } from './dto/public-signup.dto';

@ApiTags('volunteers')
@Controller()
export class VolunteersPublicController {
  constructor(private readonly volunteers: VolunteersService) {}

  @Public()
  @Get('public/coops/:slug/volunteers')
  @ApiOperation({ summary: 'Public volunteer form details for a cooperative' })
  info(@Param('slug') slug: string) {
    return this.volunteers.publicInfo(slug);
  }

  @Public()
  @Post('public/coops/:slug/volunteers')
  @Throttle({ default: { ttl: 900000, limit: 5 } })
  @ApiOperation({ summary: 'Public volunteer signup. Sends a confirmation email.' })
  signup(@Param('slug') slug: string, @Body() dto: PublicVolunteerSignupDto) {
    return this.volunteers.publicSignup(slug, dto);
  }

  @Public()
  @Post('public/volunteers/confirm')
  @Throttle({ default: { ttl: 900000, limit: 10 } })
  @ApiOperation({ summary: 'Confirm a volunteer signup (double opt-in)' })
  confirm(@Body() dto: VolunteerTokenDto) {
    return this.volunteers.confirm(dto.token);
  }

  @Public()
  @Post('public/volunteers/withdraw')
  @Throttle({ default: { ttl: 900000, limit: 10 } })
  @ApiOperation({ summary: 'Withdraw volunteer consent with the link from an email' })
  withdraw(@Body() dto: VolunteerTokenDto) {
    return this.volunteers.withdrawByToken(dto.token);
  }
}
