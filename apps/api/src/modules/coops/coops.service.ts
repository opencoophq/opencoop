import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCoopDto } from './dto/create-coop.dto';
import { UpdateCoopDto } from './dto/update-coop.dto';
import { UpdateBrandingDto } from './dto/update-branding.dto';

@Injectable()
export class CoopsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.coop.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        createdAt: true,
        _count: {
          select: {
            shareholders: true,
            shares: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findBySlug(slug: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { slug },
      include: {
        shareClasses: {
          where: { isActive: true },
          orderBy: { code: 'asc' },
        },
        projects: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    return coop;
  }

  async getPublicInfo(slug: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        bankName: true,
        bankIban: true,
        bankBic: true,
        termsUrl: true,
        shareClasses: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            code: true,
            pricePerShare: true,
            minShares: true,
            maxShares: true,
            hasVotingRights: true,
          },
          orderBy: { code: 'asc' },
        },
        projects: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            description: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    return coop;
  }

  async create(createCoopDto: CreateCoopDto) {
    // Check if slug is already in use
    const existingSlug = await this.prisma.coop.findUnique({
      where: { slug: createCoopDto.slug },
    });

    if (existingSlug) {
      throw new ConflictException('Slug already in use');
    }

    // Auto-generate a unique OGM prefix
    const ogmPrefix = await this.generateUniqueOgmPrefix();

    return this.prisma.coop.create({
      data: {
        ...createCoopDto,
        ogmPrefix,
      },
    });
  }

  private async generateUniqueOgmPrefix(): Promise<string> {
    // Find the highest existing prefix and increment
    const coops = await this.prisma.coop.findMany({
      select: { ogmPrefix: true },
      orderBy: { ogmPrefix: 'desc' },
      take: 1,
    });

    if (coops.length === 0) {
      return '001';
    }

    const lastPrefix = parseInt(coops[0].ogmPrefix, 10);
    const nextPrefix = lastPrefix + 1;

    // Ensure it stays within 3 digits (max 999)
    if (nextPrefix > 999) {
      throw new ConflictException('Maximum number of cooperatives reached');
    }

    return nextPrefix.toString().padStart(3, '0');
  }

  async update(id: string, updateCoopDto: UpdateCoopDto) {
    const coop = await this.prisma.coop.findUnique({ where: { id } });
    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    return this.prisma.coop.update({
      where: { id },
      data: updateCoopDto,
    });
  }

  async updateBranding(id: string, updateBrandingDto: UpdateBrandingDto) {
    const coop = await this.prisma.coop.findUnique({ where: { id } });
    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    return this.prisma.coop.update({
      where: { id },
      data: updateBrandingDto,
    });
  }

  async getAdmins(coopId: string) {
    return this.prisma.coopAdmin.findMany({
      where: { coopId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }

  async addAdmin(coopId: string, userId: string) {
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.coopAdmin.create({
      data: {
        coopId,
        userId,
      },
    });
  }

  async removeAdmin(coopId: string, userId: string) {
    const admin = await this.prisma.coopAdmin.findUnique({
      where: {
        userId_coopId: { userId, coopId },
      },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    return this.prisma.coopAdmin.delete({
      where: { id: admin.id },
    });
  }
}
