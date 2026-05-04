import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { CoopAdminsService } from './coop-admins.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';

@ApiTags('coop-admins')
@Controller('admin/coops/:coopId/team')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard, PermissionGuard)
@Roles('SYSTEM_ADMIN', 'COOP_ADMIN')
@ApiBearerAuth()
export class CoopAdminsController {
  constructor(private coopAdminsService: CoopAdminsService) {}

  // ==================== ROLES ====================

  @Get('roles')
  @ApiOperation({ summary: 'List coop roles' })
  getRoles(@Param('coopId') coopId: string) {
    return this.coopAdminsService.getRoles(coopId);
  }

  @Post('roles')
  @RequirePermission('canManageAdmins')
  @ApiOperation({ summary: 'Create a custom role' })
  createRole(@Param('coopId') coopId: string, @Body() dto: CreateRoleDto) {
    return this.coopAdminsService.createRole(coopId, dto);
  }

  @Put('roles/:roleId')
  @RequirePermission('canManageAdmins')
  @ApiOperation({ summary: 'Update a role' })
  updateRole(
    @Param('coopId') coopId: string,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.coopAdminsService.updateRole(coopId, roleId, dto);
  }

  @Delete('roles/:roleId')
  @RequirePermission('canManageAdmins')
  @ApiOperation({ summary: 'Delete a custom role' })
  deleteRole(@Param('coopId') coopId: string, @Param('roleId') roleId: string) {
    return this.coopAdminsService.deleteRole(coopId, roleId);
  }

  // ==================== ADMINS ====================

  @Get()
  @ApiOperation({ summary: 'List coop admins' })
  getAdmins(@Param('coopId') coopId: string) {
    return this.coopAdminsService.getAdmins(coopId);
  }

  @Post('invite')
  @RequirePermission('canManageAdmins')
  @ApiOperation({ summary: 'Invite a new admin by email' })
  inviteAdmin(@Param('coopId') coopId: string, @Body() dto: InviteAdminDto) {
    return this.coopAdminsService.inviteAdmin(coopId, dto);
  }

  @Put(':adminId/roles')
  @RequirePermission('canManageAdmins')
  @ApiOperation({ summary: "Replace the full set of roles assigned to an admin" })
  updateAdminRoles(
    @Param('coopId') coopId: string,
    @Param('adminId') adminId: string,
    @Body('roleIds') roleIds: string[],
  ) {
    return this.coopAdminsService.updateAdminRoles(coopId, adminId, roleIds);
  }

  @Put(':adminId/permissions')
  @RequirePermission('canManageAdmins')
  @ApiOperation({ summary: 'Set per-user permission overrides' })
  updatePermissionOverrides(
    @Param('coopId') coopId: string,
    @Param('adminId') adminId: string,
    @Body('permissionOverrides') overrides: Record<string, boolean> | null,
  ) {
    return this.coopAdminsService.updateAdminPermissionOverrides(coopId, adminId, overrides);
  }

  @Delete(':adminId')
  @RequirePermission('canManageAdmins')
  @ApiOperation({ summary: 'Remove an admin' })
  removeAdmin(@Param('coopId') coopId: string, @Param('adminId') adminId: string) {
    return this.coopAdminsService.removeAdmin(coopId, adminId);
  }

  // ==================== MY NOTIFICATION SETTINGS ====================

  @Get('me/notifications')
  @ApiOperation({ summary: 'Get my notification settings for this coop' })
  getMyNotificationSettings(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.coopAdminsService.getNotificationSettings(coopId, user.id);
  }

  @Patch('me/notifications')
  @ApiOperation({ summary: 'Update my notification settings for this coop' })
  updateMyNotificationSettings(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: {
      frequency?: 'IMMEDIATE' | 'DAILY' | 'WEEKLY';
      digestHour?: number;
      notifyOnNewShareholder?: boolean;
      notifyOnSharePurchase?: boolean;
      notifyOnShareSell?: boolean;
      notifyOnPaymentReceived?: boolean;
    },
  ) {
    return this.coopAdminsService.updateNotificationSettings(coopId, user.id, dto);
  }

  // ==================== INVITATIONS ====================

  @Get('invitations')
  @RequirePermission('canManageAdmins')
  @ApiOperation({ summary: 'List pending invitations' })
  getInvitations(@Param('coopId') coopId: string) {
    return this.coopAdminsService.getInvitations(coopId);
  }

  @Delete('invitations/:invitationId')
  @RequirePermission('canManageAdmins')
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  revokeInvitation(
    @Param('coopId') coopId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.coopAdminsService.revokeInvitation(coopId, invitationId);
  }
}
