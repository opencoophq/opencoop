import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { MeetingsService } from './meetings.service';
import { AgendaService } from './agenda.service';
import { ProxiesService } from './proxies.service';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { CreateAgendaItemDto } from './dto/create-agenda-item.dto';
import { UpdateAgendaItemDto } from './dto/update-agenda-item.dto';
import { CreateProxyDto } from './dto/create-proxy.dto';

@ApiTags('Meetings')
@ApiBearerAuth()
@Controller('admin/coops/:coopId/meetings')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard)
@Roles('COOP_ADMIN', 'SYSTEM_ADMIN')
export class MeetingsController {
  constructor(
    private meetings: MeetingsService,
    private agenda: AgendaService,
    private proxies: ProxiesService,
  ) {}

  @Post()
  create(@Param('coopId') coopId: string, @Body() dto: CreateMeetingDto) {
    return this.meetings.create(coopId, dto);
  }

  @Get()
  list(@Param('coopId') coopId: string) {
    return this.meetings.list(coopId);
  }

  @Get(':id')
  get(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.meetings.get(coopId, id);
  }

  @Patch(':id')
  update(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMeetingDto,
  ) {
    return this.meetings.update(coopId, id, dto);
  }

  @Delete(':id')
  delete(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.meetings.delete(coopId, id);
  }

  @Post(':id/cancel')
  cancel(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    return this.meetings.cancel(coopId, id, reason);
  }

  @Post(':id/agenda-items')
  addAgendaItem(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Body() dto: CreateAgendaItemDto,
  ) {
    return this.agenda.addItem(coopId, id, dto);
  }

  @Patch(':id/agenda-items/:itemId')
  updateAgendaItem(
    @Param('coopId') coopId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateAgendaItemDto,
  ) {
    return this.agenda.updateItem(coopId, itemId, dto);
  }

  @Delete(':id/agenda-items/:itemId')
  removeAgendaItem(@Param('coopId') coopId: string, @Param('itemId') itemId: string) {
    return this.agenda.removeItem(coopId, itemId);
  }

  @Post(':id/agenda-items/:itemId/attachments')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadAgendaAttachment(
    @Param('coopId') coopId: string,
    @Param('itemId') itemId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.agenda.addAttachment(coopId, itemId, file);
  }

  @Post(':id/proxies')
  createProxy(@Param('id') id: string, @Body() dto: CreateProxyDto) {
    return this.proxies.create(id, dto.grantorShareholderId, dto.delegateShareholderId);
  }

  @Get(':id/proxies')
  listProxies(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.proxies.list(coopId, id);
  }

  @Delete(':id/proxies/:proxyId')
  revokeProxy(@Param('coopId') coopId: string, @Param('proxyId') proxyId: string) {
    return this.proxies.revoke(coopId, proxyId);
  }
}
