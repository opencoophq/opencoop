import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAgendaItemDto } from './dto/create-agenda-item.dto';
import { UpdateAgendaItemDto } from './dto/update-agenda-item.dto';
import { AgendaType } from '@opencoop/database';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const AGENDA_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const AGENDA_ATTACHMENT_ALLOWED_MIME = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

@Injectable()
export class AgendaService {
  constructor(private prisma: PrismaService) {}

  private async getItemInCoopOrThrow(itemId: string, coopId: string) {
    const item = await this.prisma.agendaItem.findUnique({
      where: { id: itemId },
      include: { resolution: true, meeting: { select: { coopId: true } } },
    });
    if (!item) throw new NotFoundException('Agenda item not found');
    if (item.meeting.coopId !== coopId) throw new ForbiddenException('Agenda item does not belong to this coop');
    return item;
  }

  private async assertMeetingInCoop(meetingId: string, coopId: string) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId }, select: { coopId: true } });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.coopId !== coopId) throw new ForbiddenException('Meeting does not belong to this coop');
  }

  async addItem(coopId: string, meetingId: string, dto: CreateAgendaItemDto) {
    await this.assertMeetingInCoop(meetingId, coopId);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.agendaItem.create({
        data: {
          meetingId,
          order: dto.order,
          title: dto.title,
          description: dto.description,
          type: dto.type,
        },
      });

      if (dto.type !== AgendaType.INFORMATIONAL && dto.resolution) {
        await tx.resolution.create({
          data: {
            agendaItemId: item.id,
            proposedText: dto.resolution.proposedText,
            majorityType: dto.resolution.majorityType,
            quorumRequired: dto.resolution.quorumRequired ?? null,
          },
        });
      }

      return tx.agendaItem.findUniqueOrThrow({
        where: { id: item.id },
        include: { resolution: true, attachments: true },
      });
    });
  }

  async updateItem(coopId: string, itemId: string, dto: UpdateAgendaItemDto) {
    const item = await this.getItemInCoopOrThrow(itemId, coopId);

    return this.prisma.$transaction(async (tx) => {
      await tx.agendaItem.update({
        where: { id: itemId },
        data: {
          order: dto.order,
          title: dto.title,
          description: dto.description,
          type: dto.type,
        },
      });

      if (dto.resolution && item.resolution) {
        await tx.resolution.update({
          where: { agendaItemId: itemId },
          data: {
            proposedText: dto.resolution.proposedText,
            majorityType: dto.resolution.majorityType,
            quorumRequired: dto.resolution.quorumRequired ?? null,
          },
        });
      } else if (dto.resolution && !item.resolution) {
        await tx.resolution.create({
          data: {
            agendaItemId: itemId,
            proposedText: dto.resolution.proposedText,
            majorityType: dto.resolution.majorityType,
            quorumRequired: dto.resolution.quorumRequired ?? null,
          },
        });
      }

      return tx.agendaItem.findUniqueOrThrow({
        where: { id: itemId },
        include: { resolution: true, attachments: true },
      });
    });
  }

  async removeItem(coopId: string, itemId: string) {
    await this.getItemInCoopOrThrow(itemId, coopId);
    await this.prisma.agendaItem.delete({ where: { id: itemId } });
  }

  async addAttachment(coopId: string, itemId: string, file: Express.Multer.File) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }
    if (file.size > AGENDA_ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException('File exceeds 10MB limit');
    }
    if (!AGENDA_ATTACHMENT_ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    }

    await this.getItemInCoopOrThrow(itemId, coopId);

    const dir = path.join(UPLOAD_DIR, 'agenda-attachments', itemId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const safeOriginal = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedName = `${randomUUID()}-${safeOriginal}`;
    const filePath = path.join(dir, storedName);
    fs.writeFileSync(filePath, file.buffer);

    const fileUrl = `/uploads/agenda-attachments/${itemId}/${storedName}`;

    return this.prisma.agendaAttachment.create({
      data: {
        agendaItemId: itemId,
        fileName: file.originalname,
        fileUrl,
      },
    });
  }
}
