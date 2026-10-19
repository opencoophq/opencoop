import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { VolunteersService } from './volunteers.service';
import { ListVolunteersQueryDto } from './dto/list-volunteers.query';
import { MessageVolunteersDto } from './dto/message-volunteers.dto';

@ApiTags('volunteers-admin')
@ApiBearerAuth()
@Controller('admin/coops/:coopId/volunteers')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard, SubscriptionGuard, PermissionGuard)
@Roles('COOP_ADMIN', 'SYSTEM_ADMIN')
@RequirePermission('canViewVolunteers')
export class VolunteersAdminController {
  constructor(private readonly volunteers: VolunteersService) {}

  @Get()
  @ApiOperation({ summary: 'List volunteers who opted in. Never includes shareholdings.' })
  list(@Param('coopId') coopId: string, @Query() query: ListVolunteersQueryDto) {
    return this.volunteers.adminList(coopId, query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export the filtered volunteers as CSV. Writes an audit log entry.' })
  async exportCsv(
    @Param('coopId') coopId: string,
    @Query() query: ListVolunteersQueryDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const csv = await this.volunteers.adminExport(coopId, query, {
      userId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="volunteers.csv"');
    res.send(csv);
  }

  @Post('message')
  @ApiOperation({ summary: 'Email the active volunteers matching the current filters' })
  message(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() dto: MessageVolunteersDto,
  ) {
    return this.volunteers.adminMessage(coopId, dto, {
      userId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a volunteer record' })
  remove(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.volunteers.adminDelete(coopId, id, {
      userId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
