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
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { MeetingsService } from './meetings.service';
import { AgendaService } from './agenda.service';
import { ProxiesService } from './proxies.service';
import { VotesService } from './votes.service';
import { ConvocationService } from './convocation.service';
import { KioskService } from './kiosk.service';
import { AttendanceService } from './attendance.service';
import { MinutesService } from './minutes.service';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { CreateAgendaItemDto } from './dto/create-agenda-item.dto';
import { UpdateAgendaItemDto } from './dto/update-agenda-item.dto';
import { CreateProxyDto } from './dto/create-proxy.dto';
import { BulkRecordVotesDto } from './dto/record-vote.dto';
import { SendConvocationDto } from './dto/send-convocation.dto';

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
    private votes: VotesService,
    private convocation: ConvocationService,
    private kiosk: KioskService,
    private attendance: AttendanceService,
    private minutes: MinutesService,
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

  @Post(':id/resolutions/:resId/votes')
  recordVotes(
    @Param('coopId') coopId: string,
    @Param('resId') resId: string,
    @Body() dto: BulkRecordVotesDto,
  ) {
    return this.votes.recordVotes(coopId, resId, dto.votes);
  }

  @Post(':id/resolutions/:resId/close')
  closeResolution(@Param('coopId') coopId: string, @Param('resId') resId: string) {
    return this.votes.closeResolution(coopId, resId);
  }

  @Post(':id/convocation/send')
  sendConvocation(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Body() dto: SendConvocationDto,
  ) {
    return this.convocation.send(coopId, id, dto);
  }

  @Get(':id/convocation/status')
  convocationStatus(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.convocation.listStatus(coopId, id);
  }

  @Post(':id/kiosk/start')
  startKiosk(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.kiosk.startSession(coopId, id, user.id);
  }

  @Post(':id/kiosk/:sessionId/end')
  endKiosk(
    @Param('coopId') coopId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.kiosk.endSession(coopId, sessionId);
  }

  @Post(':id/attendance/:shareholderId/check-in')
  checkInAttendance(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendance.checkIn(coopId, id, shareholderId, user.id);
  }

  @Post(':id/attendance/:shareholderId/undo')
  undoCheckInAttendance(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Param('shareholderId') shareholderId: string,
  ) {
    return this.attendance.undo(coopId, id, shareholderId);
  }

  @Get(':id/live-attendance')
  liveAttendance(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.attendance.liveState(coopId, id);
  }

  @Get(':id/attendance')
  listAttendance(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.attendance.list(coopId, id);
  }

  @Get(':id/minutes')
  getMinutes(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.minutes.get(coopId, id);
  }

  @Post(':id/minutes/generate')
  generateMinutes(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.minutes.generateDraft(coopId, id);
  }

  @Patch(':id/minutes')
  updateMinutes(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Body('content') content: string,
  ) {
    return this.minutes.update(coopId, id, content);
  }

  @Post(':id/minutes/finalize')
  finalizeMinutes(@Param('coopId') coopId: string, @Param('id') id: string) {
    // PDF generation wired in Phase 11 — for now mark finalized with placeholder URL
    return this.minutes.finalize(coopId, id, '');
  }

  @Post(':id/minutes/upload-signed')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        signedByName: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadSignedMinutes(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('signedByName') signedByName: string,
  ) {
    if (!file || !file.buffer) throw new BadRequestException('No file');
    if (file.mimetype !== 'application/pdf') throw new BadRequestException('PDF required');
    const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
    const dir = path.join(UPLOAD_DIR, 'minutes', id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const stored = `${randomUUID()}-signed.pdf`;
    fs.writeFileSync(path.join(dir, stored), file.buffer);
    const url = `/uploads/minutes/${id}/${stored}`;
    return this.minutes.uploadSigned(coopId, id, url, signedByName);
  }
}
