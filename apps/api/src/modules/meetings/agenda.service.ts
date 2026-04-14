import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAgendaItemDto } from './dto/create-agenda-item.dto';
import { UpdateAgendaItemDto } from './dto/update-agenda-item.dto';
import { AgendaType } from '@opencoop/database';

@Injectable()
export class AgendaService {
  constructor(private prisma: PrismaService) {}

  async addItem(meetingId: string, dto: CreateAgendaItemDto) {
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

  async updateItem(itemId: string, dto: UpdateAgendaItemDto) {
    const item = await this.prisma.agendaItem.findUnique({
      where: { id: itemId },
      include: { resolution: true },
    });
    if (!item) throw new NotFoundException('Agenda item not found');

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

  async removeItem(itemId: string) {
    const item = await this.prisma.agendaItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Agenda item not found');
    await this.prisma.agendaItem.delete({ where: { id: itemId } });
  }
}
