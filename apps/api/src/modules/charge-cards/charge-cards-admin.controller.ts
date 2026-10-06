import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { ChargeCardsAdminService } from './charge-cards-admin.service';
import { IssueChargeCardDto } from './dto/issue-charge-card.dto';
import { ListChargeCardsQueryDto } from './dto/list-charge-cards.query';

@ApiTags('charge-cards-admin')
@ApiBearerAuth()
@Controller('admin/coops/:coopId/charge-cards')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard, SubscriptionGuard, PermissionGuard)
@Roles('COOP_ADMIN', 'SYSTEM_ADMIN')
@RequirePermission('canManageShareholders')
export class ChargeCardsAdminController {
  constructor(private readonly admin: ChargeCardsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List charge cards with waiting time; filter by status or provider to-do' })
  list(@Param('coopId') coopId: string, @Query() query: ListChargeCardsQueryDto) {
    return this.admin.list(coopId, { status: query.status, todo: query.todo === 'true' });
  }

  @Post(':id/issue')
  @ApiOperation({ summary: 'Issue a paid card: record its number, activate it, email the shareholder' })
  issue(@Param('coopId') coopId: string, @Param('id') id: string, @Body() dto: IssueChargeCardDto) {
    return this.admin.issue(coopId, id, dto.cardNumber);
  }

  @Post(':id/block')
  @ApiOperation({ summary: 'Block an active card (reason ADMIN)' })
  block(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.block(coopId, id);
  }

  @Post(':id/unblock')
  @ApiOperation({ summary: 'Lift an ADMIN block' })
  unblock(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.unblock(coopId, id);
  }

  @Post(':id/mark-lost')
  @ApiOperation({ summary: 'Mark a card lost (final)' })
  markLost(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.markLost(coopId, id);
  }

  @Post(':id/provider-sync-done')
  @ApiOperation({ summary: 'Confirm the change was made in the provider portal' })
  markProviderSyncDone(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.markProviderSyncDone(coopId, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a requested or paid card' })
  cancel(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.cancel(coopId, id);
  }
}
