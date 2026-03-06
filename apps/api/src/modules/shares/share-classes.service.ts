import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
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

    const shareClass = await this.prisma.shareClass.create({
      data: {
        ...dto,
        coopId,
      },
    });

    // Auto-link to default channel
    const defaultChannel = await this.prisma.channel.findFirst({
      where: { coopId, isDefault: true },
    });
    if (defaultChannel) {
      await this.prisma.channelShareClass.create({
        data: { channelId: defaultChannel.id, shareClassId: shareClass.id },
      });
    }

    return shareClass;
  }

  async importCsv(
    coopId: string,
    csvContent: string,
  ): Promise<{ imported: number; skipped: number }> {
    const lines = csvContent.split('\n').filter((l) => l.trim());
    if (lines.length < 2) {
      throw new BadRequestException('CSV file is empty or has no data rows');
    }

    const dataLines = lines.slice(1);
    let imported = 0;
    let skipped = 0;

    for (const line of dataLines) {
      const fields = line.split(';').map((f) => f.trim().replace(/^"|"$/g, ''));
      const [name, code, pricePerShareStr, minSharesStr, maxSharesStr, hasVotingRightsStr, dividendRateStr] = fields;

      if (!name || !code || !pricePerShareStr) {
        skipped++;
        continue;
      }

      const pricePerShare = parseFloat(pricePerShareStr.replace(',', '.'));
      if (isNaN(pricePerShare)) {
        skipped++;
        continue;
      }

      const existing = await this.prisma.shareClass.findFirst({
        where: { coopId, code },
      });

      if (existing) {
        skipped++;
        continue;
      }

      const minShares = parseInt(minSharesStr) || 1;
      const maxShares = maxSharesStr ? parseInt(maxSharesStr) || null : null;
      const hasVotingRights = hasVotingRightsStr
        ? !['false', '0', 'no', 'nee'].includes(hasVotingRightsStr.toLowerCase())
        : true;
      const dividendRateOverride = dividendRateStr
        ? parseFloat(dividendRateStr.replace(',', '.')) / 100
        : null;

      const shareClass = await this.prisma.shareClass.create({
        data: {
          coopId,
          name,
          code,
          pricePerShare,
          minShares,
          maxShares,
          hasVotingRights,
          dividendRateOverride:
            dividendRateOverride !== null && !isNaN(dividendRateOverride)
              ? dividendRateOverride
              : null,
        },
      });

      // Auto-link to default channel
      const defaultChannel = await this.prisma.channel.findFirst({
        where: { coopId, isDefault: true },
      });
      if (defaultChannel) {
        await this.prisma.channelShareClass.create({
          data: { channelId: defaultChannel.id, shareClassId: shareClass.id },
        });
      }

      imported++;
    }

    return { imported, skipped };
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
