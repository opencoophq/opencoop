import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateShareClassDto } from './dto/create-share-class.dto';
import { UpdateShareClassDto } from './dto/update-share-class.dto';

@Injectable()
export class ShareClassesService {
  constructor(private prisma: PrismaService) {}

  async findAll(coopId: string) {
    return this.prisma.shareClass.findMany({
      where: { coopId },
      orderBy: { code: 'asc' },
    });
  }

  async findById(id: string, coopId: string) {
    const shareClass = await this.prisma.shareClass.findFirst({
      where: { id, coopId },
    });

    if (!shareClass) {
      throw new NotFoundException('Share class not found');
    }

    return shareClass;
  }

  async create(coopId: string, dto: CreateShareClassDto) {
    const existing = await this.prisma.shareClass.findFirst({
      where: { coopId, code: dto.code },
    });

    if (existing) {
      throw new ConflictException('Share class code already exists');
    }

    return this.prisma.shareClass.create({
      data: {
        ...dto,
        coopId,
      },
    });
  }

  async update(id: string, coopId: string, dto: UpdateShareClassDto) {
    await this.findById(id, coopId);

    if (dto.code) {
      const existing = await this.prisma.shareClass.findFirst({
        where: { coopId, code: dto.code, NOT: { id } },
      });
      if (existing) {
        throw new ConflictException('Share class code already exists');
      }
    }

    return this.prisma.shareClass.update({
      where: { id },
      data: dto,
    });
  }
}
