import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@ApiTags('API Keys')
@Controller('admin/coops/:coopId/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard, SubscriptionGuard, PermissionGuard)
@Roles('SYSTEM_ADMIN', 'COOP_ADMIN')
@ApiBearerAuth()
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List your API keys for this coop (system admins see all)' })
  async list(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.apiKeysService.findByUser(user.id, coopId, user.role === 'SYSTEM_ADMIN');
  }

  @Post()
  @ApiOperation({ summary: 'Create a new API key — the raw key is returned once' })
  async create(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.create(user.id, coopId, dto.name);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key (system admins can revoke any)' })
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.apiKeysService.revoke(id, user.id, user.role === 'SYSTEM_ADMIN');
    return { success: true };
  }
}
