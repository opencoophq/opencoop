import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCoopDto } from './dto/create-coop.dto';
import { UpdateCoopDto } from './dto/update-coop.dto';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const LOGO_MAX_SIZE = 512;
const LOGO_QUALITY = 80;

@Injectable()
export class CoopsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const coops = await this.prisma.coop.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        emailEnabled: true,
        createdAt: true,
        _count: {
          select: {
            shareholders: true,
          },
        },
        shares: {
          where: { status: 'ACTIVE' },
          select: {
            quantity: true,
            shareClass: {
              select: { pricePerShare: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return coops.map((coop) => {
      const totalCapital = coop.shares.reduce((sum, share) => {
        const price = share.shareClass?.pricePerShare?.toNumber() || 0;
        return sum + share.quantity * price;
      }, 0);

      return {
        id: coop.id,
        slug: coop.slug,
        name: coop.name,
        logoUrl: coop.logoUrl,
        primaryColor: coop.primaryColor,
        secondaryColor: coop.secondaryColor,
        emailEnabled: coop.emailEnabled,
        createdAt: coop.createdAt,
        shareholdersCount: coop._count.shareholders,
        totalCapital,
      };
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

  async getSettings(id: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        requiresApproval: true,
        bankName: true,
        bankIban: true,
        bankBic: true,
        termsUrl: true,
        emailEnabled: true,
        emailProvider: true,
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        smtpFrom: true,
        graphClientId: true,
        graphTenantId: true,
        graphFromEmail: true,
        // Secrets (smtpPass, graphClientSecret) intentionally excluded
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

  async generateUniqueOgmPrefix(): Promise<string> {
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

    const data: Record<string, unknown> = { ...updateCoopDto };

    // Don't overwrite secrets with empty strings
    if (!data.smtpPass) delete data.smtpPass;
    if (!data.graphClientSecret) delete data.graphClientSecret;

    // When switching to platform (null), clear all custom email fields
    if (data.emailProvider === null) {
      data.smtpHost = null;
      data.smtpPort = null;
      data.smtpUser = null;
      data.smtpPass = null;
      data.smtpFrom = null;
      data.graphClientId = null;
      data.graphClientSecret = null;
      data.graphTenantId = null;
      data.graphFromEmail = null;
    }

    return this.prisma.coop.update({
      where: { id },
      data,
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

  async uploadLogo(coopId: string, file: Express.Multer.File): Promise<{ logoUrl: string }> {
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Allowed: JPEG, PNG, WebP, GIF, SVG');
    }

    const dir = path.join(UPLOAD_DIR, 'logos');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filename = `${coopId}.webp`;
    const filePath = path.join(dir, filename);

    await sharp(file.buffer)
      .resize(LOGO_MAX_SIZE, LOGO_MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: LOGO_QUALITY })
      .toFile(filePath);

    const logoUrl = `/uploads/logos/${filename}`;

    await this.prisma.coop.update({
      where: { id: coopId },
      data: { logoUrl },
    });

    return { logoUrl };
  }

  async removeLogo(coopId: string): Promise<void> {
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    // Delete the file if it exists
    const filePath = path.join(UPLOAD_DIR, 'logos', `${coopId}.webp`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await this.prisma.coop.update({
      where: { id: coopId },
      data: { logoUrl: null },
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
