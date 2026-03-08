import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { PontoService } from './ponto.service';
import { UpdatePontoSettingsDto } from './dto/ponto-connect.dto';

@ApiTags('ponto-admin')
@Controller('admin/coops/:coopId/ponto')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard, SubscriptionGuard, PermissionGuard)
@Roles('SYSTEM_ADMIN', 'COOP_ADMIN')
@ApiBearerAuth()
export class PontoAdminController {
  constructor(
    private readonly pontoService: PontoService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Get Ponto connection status' })
  async getStatus(@Param('coopId') coopId: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: { pontoEnabled: true, autoMatchPayments: true },
    });

    const connection = await this.pontoService.getConnectionStatus(coopId);

    return {
      pontoEnabled: coop?.pontoEnabled ?? false,
      autoMatchPayments: coop?.autoMatchPayments ?? true,
      connection,
    };
  }

  @Get('connect')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Get OAuth redirect URL to connect Ponto' })
  async connect(@Param('coopId') coopId: string) {
    return this.pontoService.initiateConnection(coopId);
  }

  @Post('disconnect')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Disconnect Ponto bank connection' })
  async disconnect(@Param('coopId') coopId: string) {
    await this.pontoService.disconnect(coopId);
    return { success: true };
  }

  @Post('reauthorize')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Re-authorize expired Ponto connection' })
  async reauthorize(@Param('coopId') coopId: string) {
    return this.pontoService.reauthorize(coopId);
  }

  @Put('settings')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Update Ponto auto-match setting' })
  async updateSettings(
    @Param('coopId') coopId: string,
    @Body() dto: UpdatePontoSettingsDto,
  ) {
    const updated = await this.prisma.coop.update({
      where: { id: coopId },
      data: { autoMatchPayments: dto.autoMatchPayments },
      select: { autoMatchPayments: true },
    });

    return updated;
  }
}
