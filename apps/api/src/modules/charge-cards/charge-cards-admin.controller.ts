import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  RequireAnyPermission,
  RequirePermission,
} from '../../common/decorators/permissions.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { maskShareholderRowPII } from '../../common/utils/mask-pii';
import { ChargeCardsAdminService } from './charge-cards-admin.service';
import { IssueChargeCardDto } from './dto/issue-charge-card.dto';
import { MarkChargeCardPaidDto } from './dto/mark-charge-card-paid.dto';
import { ListChargeCardsQueryDto } from './dto/list-charge-cards.query';

@ApiTags('charge-cards-admin')
@ApiBearerAuth()
@Controller('admin/coops/:coopId/charge-cards')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard, SubscriptionGuard, PermissionGuard)
@Roles('COOP_ADMIN', 'SYSTEM_ADMIN')
// No class-level permission: each handler states its own, and a spec checks
// that none is missing. Reads take either permission; writes need canManageShareholders.
export class ChargeCardsAdminController {
  constructor(private readonly admin: ChargeCardsAdminService) {}

  @Get()
  @RequireAnyPermission('canViewChargeCards', 'canManageShareholders')
  @ApiOperation({
    summary: 'List charge cards with waiting time; filter by status or provider to-do',
  })
  async list(
    @Param('coopId') coopId: string,
    @Query() query: ListChargeCardsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const rows = await this.admin.list(coopId, {
      status: query.status,
      todo: query.todo === 'true',
    });
    const canViewPII =
      user.role === 'SYSTEM_ADMIN' || user.coopPermissions?.[coopId]?.canViewPII !== false;
    return canViewPII ? rows : rows.map(maskShareholderRowPII);
  }

  @RequirePermission('canManageShareholders')
  @Post(':id/issue')
  @ApiOperation({
    summary: 'Issue a paid card: record its number, activate it, email the shareholder',
  })
  issue(@Param('coopId') coopId: string, @Param('id') id: string, @Body() dto: IssueChargeCardDto) {
    return this.admin.issue(coopId, id, dto.cardNumber);
  }

  @RequirePermission('canManageShareholders')
  @Post(':id/mark-paid')
  @ApiOperation({
    summary: 'Record a payment made outside the bank import and mark a requested card paid',
  })
  markPaid(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Body() dto: MarkChargeCardPaidDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.admin.markPaid(coopId, id, dto, user.id);
  }

  @RequirePermission('canManageShareholders')
  @Post(':id/block')
  @ApiOperation({ summary: 'Block an active card (reason ADMIN)' })
  block(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.block(coopId, id);
  }

  @RequirePermission('canManageShareholders')
  @Post(':id/unblock')
  @ApiOperation({ summary: 'Lift an ADMIN block' })
  unblock(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.unblock(coopId, id);
  }

  @RequirePermission('canManageShareholders')
  @Post(':id/mark-lost')
  @ApiOperation({ summary: 'Mark a card lost (final)' })
  markLost(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.markLost(coopId, id);
  }

  @RequirePermission('canManageShareholders')
  @Post(':id/provider-sync-done')
  @ApiOperation({ summary: 'Confirm the change was made in the provider portal' })
  markProviderSyncDone(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.markProviderSyncDone(coopId, id);
  }

  @RequirePermission('canManageShareholders')
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a requested or paid card' })
  cancel(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.cancel(coopId, id);
  }
}
