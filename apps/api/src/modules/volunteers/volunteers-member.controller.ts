import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { VolunteersService } from './volunteers.service';
import { MemberVolunteerOptInDto } from './dto/member-opt-in.dto';

@ApiTags('volunteers')
@ApiBearerAuth()
@Controller('shareholders/:shareholderId/volunteer')
@UseGuards(JwtAuthGuard)
export class VolunteersMemberController {
  constructor(private readonly volunteers: VolunteersService) {}

  @Get()
  @ApiOperation({ summary: 'Own volunteer registration, prefilled from the shareholder record' })
  view(@Param('shareholderId') shareholderId: string, @CurrentUser() user: CurrentUserData) {
    return this.volunteers.memberView(shareholderId, user.id);
  }

  @Put()
  @ApiOperation({ summary: 'Opt in as a volunteer, or update interests' })
  optIn(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: MemberVolunteerOptInDto,
  ) {
    return this.volunteers.memberOptIn(shareholderId, user.id, dto);
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Withdraw your own volunteer registration' })
  withdraw(@Param('shareholderId') shareholderId: string, @CurrentUser() user: CurrentUserData) {
    return this.volunteers.memberWithdraw(shareholderId, user.id);
  }
}
