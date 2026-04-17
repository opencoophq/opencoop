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
  @ApiOperation({
    summary: 'Search household-link candidates in this coop by email (excludes the current shareholder)',
  })
  async searchCandidates(
    @Param('coopId') coopId: string,
    @Param('shareholderId') shareholderId: string,
    @Query('search') search: string,
  ) {
    return this.household.searchHouseholdCandidates(coopId, shareholderId, search ?? '');
  }

  @Post('link')
  @ApiOperation({
    summary:
      'Link a shareholder into a household. If the target shareholder has no user account yet, one is auto-created from their email.',
  })
  async link(
    @Param('coopId') coopId: string,
    @Param('shareholderId') shareholderId: string,
    @Body() dto: LinkShareholderDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.household.linkShareholders({
      coopId,
      shareholderId,
      targetShareholderId: dto.targetShareholderId,
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
