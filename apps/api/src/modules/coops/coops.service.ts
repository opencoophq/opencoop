import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCoopDto } from './dto/create-coop.dto';
import { UpdateCoopDto } from './dto/update-coop.dto';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { PublicRegisterDto } from './dto/public-register.dto';
import { ShareholdersService } from '../shareholders/shareholders.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { AuditService } from '../audit/audit.service';
import { PRIVACY_VERSION } from '@opencoop/shared';
import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const LOGO_MAX_SIZE = 512;
const LOGO_QUALITY = 80;

@Injectable()
export class CoopsService {
  constructor(
    private prisma: PrismaService,
    private shareholdersService: ShareholdersService,
    private registrationsService: RegistrationsService,
    private auditService: AuditService,
  ) {}

  async findAll() {
    const coops = await this.prisma.coop.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        emailEnabled: true,
        pontoEnabled: true,
        plan: true,
        trialEndsAt: true,
        createdAt: true,
        channels: {
          where: { isDefault: true },
          select: {
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
          },
          take: 1,
        },
        _count: {
          select: {
            shareholders: true,
          },
        },
        registrations: {
          where: { type: 'BUY', status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] } },
          select: {
            quantity: true,
            pricePerShare: true,
            payments: {
              select: { amount: true },
            },
          },
        },
        subscription: {
          select: {
            status: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return coops.map((coop) => {
      const totalCapital = coop.registrations.reduce((sum, reg) => {
        const totalPaid = reg.payments.reduce((s, p) => s + Number(p.amount), 0);
        return sum + totalPaid;
      }, 0);

      const defaultChannel = coop.channels[0];
      return {
        id: coop.id,
        slug: coop.slug,
        name: coop.name,
        logoUrl: defaultChannel?.logoUrl ?? null,
        primaryColor: defaultChannel?.primaryColor ?? '#1e40af',
        secondaryColor: defaultChannel?.secondaryColor ?? '#3b82f6',
        emailEnabled: coop.emailEnabled,
        pontoEnabled: coop.pontoEnabled,
        plan: coop.plan,
        trialEndsAt: coop.trialEndsAt,
        subscriptionStatus: coop.subscription?.status ?? null,
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
        bankName: true,
        bankIban: true,
        bankBic: true,
        channels: {
          where: { isDefault: true },
          select: {
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
            termsUrl: true,
          },
          take: 1,
        },
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
            targetShares: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    const ch = coop.channels[0];
    return {
      id: coop.id,
      slug: coop.slug,
      name: coop.name,
      logoUrl: ch?.logoUrl ?? null,
      primaryColor: ch?.primaryColor ?? '#1e40af',
      secondaryColor: ch?.secondaryColor ?? '#3b82f6',
      bankName: coop.bankName,
      bankIban: coop.bankIban,
      bankBic: coop.bankBic,
      termsUrl: ch?.termsUrl ?? null,
      shareClasses: coop.shareClasses,
      projects: coop.projects,
    };
  }

  async getPublicProjects(slug: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { slug },
      select: {
        id: true,
        projects: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            type: true,
            capacityKw: true,
            targetShares: true,
            isActive: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    const projectIds = coop.projects.map((p) => p.id);

    const regStats = await this.prisma.registration.groupBy({
      by: ['projectId'],
      where: {
        projectId: { in: projectIds },
        type: 'BUY',
        status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] },
      },
      _sum: { quantity: true },
    });

    // Get distinct shareholder counts per project
    const shareholderCounts = await Promise.all(
      projectIds.map(async (projectId) => {
        const count = await this.prisma.registration.findMany({
          where: { projectId, type: 'BUY', status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] } },
          select: { shareholderId: true },
          distinct: ['shareholderId'],
        });
        return { projectId, count: count.length };
      }),
    );

    // Get capital raised per project (sum of payments)
    const capitalByProject = await Promise.all(
      projectIds.map(async (projectId) => {
        const registrations = await this.prisma.registration.findMany({
          where: { projectId, type: 'BUY', status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] } },
          include: { payments: { select: { amount: true } } },
        });
        const capital = registrations.reduce(
          (sum, reg) => sum + reg.payments.reduce((s, p) => s + Number(p.amount), 0),
          0,
        );
        return { projectId, capital };
      }),
    );

    const statsMap = new Map(regStats.map((s) => [s.projectId, s]));
    const shareholderMap = new Map(shareholderCounts.map((s) => [s.projectId, s.count]));
    const capitalMap = new Map(capitalByProject.map((c) => [c.projectId, c.capital]));

    return coop.projects.map((project) => {
      const stats = statsMap.get(project.id);
      return {
        id: project.id,
        name: project.name,
        type: project.type,
        capacityKw: project.capacityKw?.toNumber() ?? null,
        targetShares: project.targetShares,
        sharesSold: stats?._sum.quantity ?? 0,
        capitalRaised: capitalMap.get(project.id) ?? 0,
        shareholderCount: shareholderMap.get(project.id) ?? 0,
        isActive: project.isActive,
      };
    });
  }

  async getPublicStats(slug: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    const coopId = coop.id;

    // Query all buy registrations across the entire coop
    const buyRegistrations = await this.prisma.registration.findMany({
      where: { coopId, type: 'BUY', status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] } },
      select: {
        shareholderId: true,
        quantity: true,
        pricePerShare: true,
        payments: { select: { amount: true } },
      },
    });

    const uniqueShareholders = new Set(
      buyRegistrations.map((r) => r.shareholderId),
    ).size;
    const totalCapital = buyRegistrations.reduce(
      (sum, r) => sum + r.payments.reduce((s, p) => s + Number(p.amount), 0),
      0,
    );
    const totalShares = buyRegistrations.reduce((sum, r) => {
      const totalPaid = r.payments.reduce((s, p) => s + Number(p.amount), 0);
      const pricePerShare = Number(r.pricePerShare);
      return sum + (pricePerShare > 0 ? Math.min(Math.floor(totalPaid / pricePerShare), r.quantity) : 0);
    }, 0);

    const projectCount = await this.prisma.project.count({
      where: { coopId, isActive: true },
    });

    return {
      shareholderCount: uniqueShareholders,
      totalCapital,
      totalShares,
      projectCount,
    };
  }

  async getSettings(id: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        requiresApproval: true,
        minimumHoldingPeriod: true,
        bankName: true,
        bankIban: true,
        bankBic: true,
        emailEnabled: true,
        pontoEnabled: true,
        autoMatchPayments: true,
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

    return this.prisma.$transaction(async (tx) => {
      const coop = await tx.coop.create({
        data: {
          ...createCoopDto,
          ogmPrefix,
        },
      });

      // Create default channel for the new coop
      await tx.channel.create({
        data: {
          coopId: coop.id,
          slug: 'default',
          name: coop.name,
          isDefault: true,
        },
      });

      return coop;
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

  async update(id: string, updateCoopDto: UpdateCoopDto, actorId?: string, ip?: string, userAgent?: string) {
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

    const changes = this.auditService.diff(coop as Record<string, unknown>, data);

    const updated = await this.prisma.coop.update({
      where: { id },
      data,
    });

    if (changes.length > 0) {
      await this.auditService.log({
        coopId: id,
        entity: 'Coop',
        entityId: id,
        action: 'UPDATE',
        changes,
        actorId,
        ipAddress: ip,
        userAgent,
      });
    }

    return updated;
  }

  async updateBranding(id: string, updateBrandingDto: UpdateBrandingDto, actorId?: string, ip?: string, userAgent?: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { coopId: id, isDefault: true },
    });
    if (!channel) throw new NotFoundException('Default channel not found');

    const changes = this.auditService.diff(
      { primaryColor: channel.primaryColor, secondaryColor: channel.secondaryColor },
      updateBrandingDto as Record<string, unknown>,
    );

    const updated = await this.prisma.channel.update({
      where: { id: channel.id },
      data: updateBrandingDto,
    });

    if (changes.length > 0) {
      await this.auditService.log({
        coopId: id,
        entity: 'Channel',
        entityId: channel.id,
        action: 'UPDATE',
        changes,
        actorId,
        ipAddress: ip,
        userAgent,
      });
    }

    return updated;
  }

  async uploadLogo(coopId: string, file: Express.Multer.File, actorId?: string, ip?: string, userAgent?: string): Promise<{ logoUrl: string }> {
    const channel = await this.prisma.channel.findFirst({
      where: { coopId, isDefault: true },
    });
    if (!channel) throw new NotFoundException('Default channel not found');

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

    const filename = `${channel.id}.webp`;
    const filePath = path.join(dir, filename);

    await sharp(file.buffer)
      .resize(LOGO_MAX_SIZE, LOGO_MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: LOGO_QUALITY })
      .toFile(filePath);

    const logoUrl = `/uploads/logos/${filename}`;
    const oldLogoUrl = channel.logoUrl;

    await this.prisma.channel.update({
      where: { id: channel.id },
      data: { logoUrl },
    });

    await this.auditService.log({
      coopId,
      entity: 'Coop',
      entityId: coopId,
      action: 'UPDATE',
      changes: [{ field: 'logoUrl', oldValue: oldLogoUrl, newValue: logoUrl }],
      actorId,
      ipAddress: ip,
      userAgent,
    });

    return { logoUrl };
  }

  async removeLogo(coopId: string, actorId?: string, ip?: string, userAgent?: string): Promise<void> {
    const channel = await this.prisma.channel.findFirst({
      where: { coopId, isDefault: true },
    });
    if (!channel) throw new NotFoundException('Default channel not found');

    const oldLogoUrl = channel.logoUrl;

    // Delete the file if it exists
    const filePath = path.join(UPLOAD_DIR, 'logos', `${channel.id}.webp`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await this.prisma.channel.update({
      where: { id: channel.id },
      data: { logoUrl: null },
    });

    if (oldLogoUrl) {
      await this.auditService.log({
        coopId,
        entity: 'Coop',
        entityId: coopId,
        action: 'UPDATE',
        changes: [{ field: 'logoUrl', oldValue: oldLogoUrl, newValue: null }],
        actorId,
        ipAddress: ip,
        userAgent,
      });
    }
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

    // Find the Admin default role for this coop
    const adminRole = await this.prisma.coopRole.findFirst({
      where: { coopId, name: 'Admin', isDefault: true },
    });
    if (!adminRole) {
      throw new NotFoundException('Admin role not found for this cooperative');
    }

    return this.prisma.coopAdmin.create({
      data: {
        coopId,
        userId,
        roleId: adminRole.id,
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

  async publicRegister(slug: string, dto: PublicRegisterDto) {
    if (!dto.privacyAccepted) {
      throw new BadRequestException('You must accept the privacy policy');
    }

    const coop = await this.findBySlug(slug);

    let shareholderId: string;

    if (dto.shareholderId) {
      // Verify shareholder belongs to this coop
      const shareholder = await this.prisma.shareholder.findFirst({
        where: { id: dto.shareholderId, coopId: coop.id },
      });
      if (!shareholder) {
        throw new NotFoundException('Shareholder not found in this cooperative');
      }
      shareholderId = shareholder.id;
    } else {
      // Create new shareholder
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
    }

    const registration = await this.registrationsService.createBuy({
      coopId: coop.id,
      shareholderId,
      shareClassId: dto.shareClassId,
      quantity: dto.quantity,
      projectId: dto.projectId,
      privacyAcceptedAt: new Date(),
      privacyVersion: PRIVACY_VERSION,
    });

    return {
      registrationId: registration.id,
      ogmCode: registration.ogmCode ?? null,
      shareholderId,
    };
  }
}
