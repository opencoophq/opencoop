import { Controller, Post, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { HouseholdService } from './household.service';

@ApiTags('household')
@Controller('admin/coops/:coopId/shareholders/:shareholderId/household')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard)
@Roles('SYSTEM_ADMIN', 'COOP_ADMIN')
@ApiBearerAuth()
export class HouseholdController {
  constructor(private readonly householdService: HouseholdService) {}

  @Post('emancipate')
  @ApiOperation({
    summary:
      'Initiate a household split — sends the shareholder a claim-account email so they can set up their own login',
  })
  async emancipate(
    @Param('coopId') coopId: string,
    @Param('shareholderId') shareholderId: string,
  ) {
    return this.householdService.unlinkShareholder(coopId, shareholderId);
  }
}
