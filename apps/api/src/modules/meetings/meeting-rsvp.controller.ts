import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Header,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RsvpService } from './rsvp.service';
import { IcsService } from './ics.service';
import { RsvpUpdateDto } from './dto/rsvp-update.dto';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const VOLMACHT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const VOLMACHT_ALLOWED = new Set<string>(['application/pdf', 'image/png', 'image/jpeg']);

@ApiTags('Public — Meeting RSVP')
@Public()
@Controller('public/meetings/rsvp')
export class MeetingRsvpController {
  constructor(private rsvp: RsvpService, private ics: IcsService) {}

  @Get(':token')
  async getDetails(@Param('token') token: string) {
    const att = await this.rsvp.resolveToken(token);
    return {
      meeting: {
        id: att.meeting.id,
        title: att.meeting.title,
        scheduledAt: att.meeting.scheduledAt,
        location: att.meeting.location,
        durationMinutes: att.meeting.durationMinutes,
        format: att.meeting.format,
        type: att.meeting.type,
        agenda: att.meeting.agendaItems,
      },
      coop: att.meeting.coop,
      shareholder: {
        id: att.shareholder.id,
        firstName: att.shareholder.firstName,
        lastName: att.shareholder.lastName,
      },
      rsvpStatus: att.rsvpStatus,
      rsvpAt: att.rsvpAt,
    };
  }

  @Patch(':token')
  updateRsvp(@Param('token') token: string, @Body() dto: RsvpUpdateDto) {
    return this.rsvp.updateRsvp(token, dto.status, dto.delegateShareholderId);
  }

  @Get(':token/eligible-delegates')
  listDelegates(@Param('token') token: string) {
    return this.rsvp.listEligibleDelegates(token);
  }

  @Get(':token/ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  async downloadIcs(@Param('token') token: string, @Res() res: Response) {
    const att = await this.rsvp.resolveToken(token);
    const content = this.ics.generate({
      uid: `meeting-${att.meeting.id}@opencoop.be`,
      title: att.meeting.title,
      start: att.meeting.scheduledAt,
      durationMinutes: att.meeting.durationMinutes,
      location: att.meeting.location ?? '',
      description: att.meeting.agendaItems
        .map((a) => `${a.order}. ${a.title}`)
        .join('\n'),
      organizerName: att.meeting.coop.name,
      organizerEmail: att.meeting.coop.coopEmail ?? 'noreply@opencoop.be',
    });
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(att.meeting.title)}.ics"`,
    );
    res.send(content);
  }

  @Post(':token/proxy/upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: VOLMACHT_MAX_BYTES } }))
  async uploadSigned(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }
    if (file.size > VOLMACHT_MAX_BYTES) {
      throw new BadRequestException('File exceeds 10MB limit');
    }
    if (!VOLMACHT_ALLOWED.has(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    }

    const att = await this.rsvp.resolveToken(token);

    const dir = path.join(UPLOAD_DIR, 'volmachten', att.meetingId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const safeOriginal = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedName = `${randomUUID()}-${safeOriginal}`;
    const filePath = path.join(dir, storedName);
    fs.writeFileSync(filePath, file.buffer);

    const fileUrl = `/uploads/volmachten/${att.meetingId}/${storedName}`;
    return this.rsvp.attachSignedVolmacht(token, fileUrl);
  }
}
