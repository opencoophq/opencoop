import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { HouseholdService } from './household.service';
import { LinkShareholderDto } from './dto/link-shareholder.dto';

@ApiTags('Shareholders')
@ApiBearerAuth()
@Controller('admin/coops/:coopId/shareholders/:shareholderId/household')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard)
@Roles('COOP_ADMIN', 'SYSTEM_ADMIN')
export class HouseholdController {
  constructor(private readonly household: HouseholdService) {}

  @Get('search-users')
  @ApiOperation({ summary: 'Search users in this coop by email (for household linking)' })
  async searchUsers(
    @Param('coopId') coopId: string,
    @Query('search') search: string,
  ) {
    return this.household.searchUsersInCoop(coopId, search ?? '');
  }

  @Post('link')
  @ApiOperation({ summary: 'Link a shareholder to an existing user account (shared-household)' })
  async link(
    @Param('coopId') coopId: string,
    @Param('shareholderId') shareholderId: string,
    @Body() dto: LinkShareholderDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.household.linkShareholderToUser({
      coopId,
      shareholderId,
      targetUserId: dto.targetUserId,
      actorUserId: user.id,
    });
  }

  @Post('emancipate')
  @ApiOperation({ summary: 'Unlink a shareholder from a shared household (emancipation)' })
  async emancipate(
    @Param('coopId') coopId: string,
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.household.unlinkShareholder({
      coopId,
      shareholderId,
      actorUserId: user.id,
    });
  }
}
