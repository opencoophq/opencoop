import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ShareholdersService } from '../shareholders/shareholders.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { PublicRegisterDto } from '../coops/dto/public-register.dto';
import { ClaimGiftDto } from './dto/claim-gift.dto';
import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const LOGO_MAX_SIZE = 512;
const LOGO_QUALITY = 80;

@Injectable()
export class ChannelsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private shareholdersService: ShareholdersService,
    private registrationsService: RegistrationsService,
  ) {}

  async findAll(coopId: string) {
    return this.prisma.channel.findMany({
      where: { coopId },
      include: {
        _count: {
          select: {
            shareClasses: true,
            projects: true,
          },
        },
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async findById(id: string, coopId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id, coopId },
      include: {
        shareClasses: {
          include: {
            shareClass: {
              select: {
                id: true,
                name: true,
                code: true,
                pricePerShare: true,
                isActive: true,
              },
            },
          },
        },
        projects: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return channel;
  }

  async getPublicInfo(coopSlug: string, channelSlug: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { slug: coopSlug },
      select: {
        id: true,
        slug: true,
        bankName: true,
        bankIban: true,
        bankBic: true,
      },
    });

    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    const channel = await this.prisma.channel.findFirst({
      where: { coopId: coop.id, slug: channelSlug, active: true },
      include: {
        shareClasses: {
          include: {
            shareClass: {
              select: {
                id: true,
                name: true,
                code: true,
                pricePerShare: true,
                minShares: true,
                maxShares: true,
                hasVotingRights: true,
                isActive: true,
              },
            },
          },
        },
        projects: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
                description: true,
                targetShares: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // Filter for active share classes and sort by code
    const shareClasses = channel.shareClasses
      .map((cs) => cs.shareClass)
      .filter((sc) => sc.isActive)
      .sort((a, b) => a.code.localeCompare(b.code));

    // Filter for active projects and sort by name
    const projects = channel.projects
      .map((cp) => cp.project)
      .filter((p) => p.isActive)
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      id: coop.id,
      slug: coop.slug,
      name: channel.name,
      description: channel.description,
      logoUrl: channel.logoUrl,
      primaryColor: channel.primaryColor,
      secondaryColor: channel.secondaryColor,
      termsUrl: channel.termsUrl,
      bankName: coop.bankName,
      bankIban: coop.bankIban,
      bankBic: coop.bankBic,
      channelId: channel.id,
      channelSlug: channel.slug,
      shareClasses,
      projects,
    };
  }

  async create(coopId: string, dto: CreateChannelDto, actorId?: string) {
    // Validate slug uniqueness within coop
    const existing = await this.prisma.channel.findFirst({
      where: { coopId, slug: dto.slug },
    });

    if (existing) {
      throw new ConflictException('A channel with this slug already exists in this cooperative');
    }

    const { shareClassIds, projectIds, ...channelData } = dto;

    const channel = await this.prisma.channel.create({
      data: {
        ...channelData,
        coopId,
        shareClasses: shareClassIds?.length
          ? {
              create: shareClassIds.map((shareClassId) => ({ shareClassId })),
            }
          : undefined,
        projects: projectIds?.length
          ? {
              create: projectIds.map((projectId) => ({ projectId })),
            }
          : undefined,
      },
      include: {
        shareClasses: true,
        projects: true,
      },
    });

    await this.auditService.log({
      coopId,
      entity: 'Channel',
      entityId: channel.id,
      action: 'CREATE',
      changes: [{ field: 'channel', oldValue: null, newValue: dto.name }],
      actorId,
    });

    return channel;
  }

  async update(id: string, coopId: string, dto: UpdateChannelDto, actorId?: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id, coopId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const { shareClassIds, projectIds, ...channelData } = dto;

    // Build diff for audit (excluding relation arrays)
    const changes = this.auditService.diff(
      channel as unknown as Record<string, unknown>,
      channelData as Record<string, unknown>,
    );

    // Update channel and replace join table entries in a transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      // Replace share class links if provided
      if (shareClassIds !== undefined) {
        await tx.channelShareClass.deleteMany({ where: { channelId: id } });
        if (shareClassIds.length > 0) {
          await tx.channelShareClass.createMany({
            data: shareClassIds.map((shareClassId) => ({ channelId: id, shareClassId })),
          });
        }
      }

      // Replace project links if provided
      if (projectIds !== undefined) {
        await tx.channelProject.deleteMany({ where: { channelId: id } });
        if (projectIds.length > 0) {
          await tx.channelProject.createMany({
            data: projectIds.map((projectId) => ({ channelId: id, projectId })),
          });
        }
      }

      return tx.channel.update({
        where: { id },
        data: channelData,
        include: {
          shareClasses: true,
          projects: true,
        },
      });
    });

    if (changes.length > 0 || shareClassIds !== undefined || projectIds !== undefined) {
      if (shareClassIds !== undefined) {
        changes.push({ field: 'shareClassIds', oldValue: null, newValue: shareClassIds });
      }
      if (projectIds !== undefined) {
        changes.push({ field: 'projectIds', oldValue: null, newValue: projectIds });
      }

      await this.auditService.log({
        coopId,
        entity: 'Channel',
        entityId: id,
        action: 'UPDATE',
        changes,
        actorId,
      });
    }

    return updated;
  }

  async delete(id: string, coopId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id, coopId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.isDefault) {
      throw new BadRequestException('Cannot delete the default channel');
    }

    await this.prisma.channel.delete({ where: { id } });
  }

  async uploadLogo(
    id: string,
    coopId: string,
    file: Express.Multer.File,
  ): Promise<{ logoUrl: string }> {
    const channel = await this.prisma.channel.findFirst({
      where: { id, coopId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
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

    const filename = `${id}.webp`;
    const filePath = path.join(dir, filename);

    await sharp(file.buffer)
      .resize(LOGO_MAX_SIZE, LOGO_MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: LOGO_QUALITY })
      .toFile(filePath);

    const logoUrl = `/uploads/logos/${filename}`;

    await this.prisma.channel.update({
      where: { id },
      data: { logoUrl },
    });

    return { logoUrl };
  }

  async removeLogo(id: string, coopId: string): Promise<void> {
    const channel = await this.prisma.channel.findFirst({
      where: { id, coopId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // Delete the file if it exists
    const filePath = path.join(UPLOAD_DIR, 'logos', `${id}.webp`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await this.prisma.channel.update({
      where: { id },
      data: { logoUrl: null },
    });
  }

  async publicRegister(coopSlug: string, channelSlug: string, dto: PublicRegisterDto) {
    // 1. Find coop by slug
    const coop = await this.prisma.coop.findUnique({
      where: { slug: coopSlug },
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

    // 2. Find channel by coopId + channelSlug (verify active)
    const channel = await this.prisma.channel.findFirst({
      where: { coopId: coop.id, slug: channelSlug, active: true },
      include: {
        shareClasses: true,
        projects: true,
      },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // 3. Verify shareClassId is linked to this channel
    const isShareClassLinked = channel.shareClasses.some(
      (cs) => cs.shareClassId === dto.shareClassId,
    );
    if (!isShareClassLinked) {
      throw new BadRequestException('Share class is not available through this channel');
    }

    // 4. If projectId provided, verify it's linked to this channel
    if (dto.projectId) {
      const isProjectLinked = channel.projects.some((cp) => cp.projectId === dto.projectId);
      if (!isProjectLinked) {
        throw new BadRequestException('Project is not available through this channel');
      }
    }

    // 5. Create shareholder / find existing
    let shareholderId: string;

    if (dto.shareholderId) {
      const shareholder = await this.prisma.shareholder.findFirst({
        where: { id: dto.shareholderId, coopId: coop.id },
      });
      if (!shareholder) {
        throw new NotFoundException('Shareholder not found in this cooperative');
      }
      shareholderId = shareholder.id;
    } else {
      if (!dto.type) {
        throw new BadRequestException('Shareholder type is required for new registrations');
      }
      if (!dto.email) {
        throw new BadRequestException('Email is required for new registrations');
      }

      const newShareholder = await this.shareholdersService.create(coop.id, {
        type: dto.type,
        firstName: dto.firstName,
        lastName: dto.lastName,
        birthDate: dto.birthDate,
        companyName: dto.companyName,
        companyId: dto.companyId,
        vatNumber: dto.vatNumber,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
      });
      shareholderId = newShareholder.id;

      // Set channelId on newly created shareholder
      await this.prisma.shareholder.update({
        where: { id: shareholderId },
        data: { channelId: channel.id },
      });
    }

    // 6. Create registration via RegistrationsService
    const registration = await this.registrationsService.createBuy({
      coopId: coop.id,
      shareholderId,
      shareClassId: dto.shareClassId,
      quantity: dto.quantity,
      projectId: dto.projectId,
      channelId: channel.id,
      isGift: dto.isGift,
    });

    return {
      registrationId: registration.id,
      ogmCode: registration.ogmCode ?? null,
      shareholderId,
    };
  }

  async validateGiftCode(coopSlug: string, channelSlug: string, code: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { slug: coopSlug },
    });

    if (!coop) {
      return { valid: false };
    }

    const registration = await this.prisma.registration.findUnique({
      where: { giftCode: code },
      include: { shareClass: true },
    });

    if (
      !registration ||
      registration.coopId !== coop.id ||
      registration.status !== 'COMPLETED' ||
      !registration.isGift ||
      registration.giftClaimedAt
    ) {
      return { valid: false };
    }

    return {
      valid: true,
      coopName: coop.name,
      shareClassName: registration.shareClass.name,
      quantity: registration.quantity,
      totalValue: Number(registration.totalAmount),
    };
  }

  async claimGift(coopSlug: string, channelSlug: string, dto: ClaimGiftDto) {
    const coop = await this.prisma.coop.findUnique({
      where: { slug: coopSlug },
    });

    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    const registration = await this.prisma.registration.findUnique({
      where: { giftCode: dto.giftCode },
      include: { shareClass: true },
    });

    if (
      !registration ||
      registration.coopId !== coop.id ||
      registration.status !== 'COMPLETED' ||
      !registration.isGift ||
      registration.giftClaimedAt
    ) {
      throw new BadRequestException('Invalid or already claimed gift code');
    }

    // Create recipient shareholder
    const recipientShareholder = await this.shareholdersService.create(coop.id, {
      type: 'INDIVIDUAL',
      firstName: dto.firstName,
      lastName: dto.lastName,
      birthDate: dto.birthDate,
      email: dto.email,
      phone: dto.phone,
      address: dto.address,
    });

    // Transfer shares: buyer → recipient (no processedByUserId — self-service gift claim)
    await this.registrationsService.createTransfer({
      coopId: coop.id,
      fromShareholderId: registration.shareholderId,
      toShareholderId: recipientShareholder.id,
      registrationId: registration.id,
      quantity: registration.quantity,
    });

    // Mark gift as claimed
    await this.prisma.registration.update({
      where: { id: registration.id },
      data: {
        giftClaimedAt: new Date(),
        giftClaimedByShareholderId: recipientShareholder.id,
      },
    });

    return {
      success: true,
      shareholderId: recipientShareholder.id,
    };
  }
}
