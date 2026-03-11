import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateShareholderDto } from './dto/create-shareholder.dto';
import { UpdateShareholderDto } from './dto/update-shareholder.dto';
import { encryptField, decryptField, isEncrypted } from '../../common/crypto';
import { generateReferralCode } from '@opencoop/shared';

@Injectable()
export class ShareholdersService {
  constructor(private prisma: PrismaService, private auditService: AuditService) {}

  private decryptShareholder<T extends { nationalId?: string | null; beneficialOwners?: Array<{ nationalId?: string | null }> }>(
    shareholder: T,
  ): T {
    if (shareholder.nationalId && isEncrypted(shareholder.nationalId)) {
      shareholder.nationalId = decryptField(shareholder.nationalId);
    }
    if (shareholder.beneficialOwners) {
      for (const bo of shareholder.beneficialOwners) {
        if (bo.nationalId && isEncrypted(bo.nationalId)) {
          bo.nationalId = decryptField(bo.nationalId);
        }
      }
    }
    return shareholder;
  }

  async findAll(
    coopId: string,
    params: {
      page?: number;
      pageSize?: number;
      search?: string;
      status?: string;
      type?: string;
      ecoPowerClient?: string;
    } = {},
  ) {
    const page = Number(params.page) || 1;
    const pageSize = Number(params.pageSize) || 25;
    const { search, status, type } = params;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = { coopId };

    if (status) {
      where.status = status;
    }
    if (type) {
      where.type = type;
    }
    if (params.ecoPowerClient === 'true') where.isEcoPowerClient = true;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.shareholder.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          registrations: {
            where: { type: 'BUY', status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] } },
            include: { shareClass: true, payments: true },
          },
          beneficialOwners: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.shareholder.count({ where }),
    ]);

    return {
      items: items.map((item) => this.decryptShareholder(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findById(id: string, coopId: string) {
    const shareholder = await this.prisma.shareholder.findFirst({
      where: { id, coopId },
      include: {
        registrations: {
          orderBy: { createdAt: 'desc' },
          include: {
            shareClass: true,
            project: true,
            payments: { orderBy: { bankDate: 'asc' } },
          },
        },
        beneficialOwners: true,
        documents: {
          orderBy: { generatedAt: 'desc' },
        },
        dividendPayouts: {
          include: {
            dividendPeriod: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!shareholder) {
      throw new NotFoundException('Shareholder not found');
    }

    return this.decryptShareholder(shareholder);
  }

  async create(coopId: string, dto: CreateShareholderDto, actorId?: string, ip?: string, userAgent?: string) {
    if (dto.email) {
      const existing = await this.prisma.shareholder.findFirst({
        where: { coopId, email: dto.email.toLowerCase() },
      });
      if (existing) {
        throw new ConflictException('A shareholder with this email already exists in this cooperative');
      }
    }

    const { beneficialOwners, birthDate, address, ...rest } = dto;

    // Encrypt nationalId fields before storage
    const nationalId = rest.nationalId ? encryptField(rest.nationalId) : rest.nationalId;
    const encryptedBeneficialOwners = beneficialOwners?.map((bo) => ({
      ...bo,
      nationalId: bo.nationalId ? encryptField(bo.nationalId) : bo.nationalId,
    }));

    // Generate unique referral code (retry on collision)
    let referralCode: string | null = null;
    for (let i = 0; i < 5; i++) {
      const candidate = generateReferralCode();
      const existing = await this.prisma.shareholder.findFirst({ where: { referralCode: candidate } });
      if (!existing) {
        referralCode = candidate;
        break;
      }
    }

    const created = await this.prisma.shareholder.create({
      data: {
        ...rest,
        nationalId,
        coopId,
        email: rest.email?.toLowerCase(),
        birthDate: birthDate ? new Date(birthDate) : null,
        status: 'ACTIVE',
        referralCode,
        address: address ? JSON.parse(JSON.stringify(address)) : undefined,
        beneficialOwners: encryptedBeneficialOwners?.length
          ? {
              create: encryptedBeneficialOwners,
            }
          : undefined,
      },
      include: {
        beneficialOwners: true,
      },
    });

    await this.auditService.log({
      coopId,
      entity: 'Shareholder',
      entityId: created.id,
      action: 'CREATE',
      changes: [{ field: '_created', oldValue: null, newValue: dto.type }],
      actorId,
      ipAddress: ip,
      userAgent,
    });

    return this.decryptShareholder(created);
  }

  async update(id: string, coopId: string, dto: UpdateShareholderDto, actorId?: string, ip?: string, userAgent?: string) {
    const existing = await this.findById(id, coopId);

    if (dto.email && dto.email.toLowerCase() !== existing.email?.toLowerCase()) {
      const emailTaken = await this.prisma.shareholder.findFirst({
        where: {
          coopId,
          email: dto.email.toLowerCase(),
          NOT: { id },
        },
      });
      if (emailTaken) {
        throw new ConflictException('A shareholder with this email already exists in this cooperative');
      }
    }

    // Reject Ecopower fields if the feature is disabled for this coop
    if (dto.isEcoPowerClient !== undefined || dto.ecoPowerId !== undefined) {
      const coop = await this.prisma.coop.findUnique({ where: { id: coopId }, select: { ecoPowerEnabled: true } });
      if (!coop?.ecoPowerEnabled) {
        throw new BadRequestException('Ecopower integration is not enabled for this cooperative');
      }
    }

    const { beneficialOwners, birthDate, address, ...rest } = dto;

    // Encrypt nationalId fields before storage
    const nationalId = rest.nationalId ? encryptField(rest.nationalId) : rest.nationalId;
    const encryptedBeneficialOwners = beneficialOwners?.map((bo) => ({
      ...bo,
      nationalId: bo.nationalId ? encryptField(bo.nationalId) : bo.nationalId,
    }));

    await this.prisma.shareholder.update({
      where: { id },
      data: {
        ...rest,
        ...(rest.nationalId !== undefined && { nationalId }),
        email: rest.email?.toLowerCase(),
        ...(address !== undefined && { address: address ? JSON.parse(JSON.stringify(address)) : null }),
        ...(birthDate !== undefined && { birthDate: birthDate ? new Date(birthDate) : null }),
        ...(encryptedBeneficialOwners && {
          beneficialOwners: {
            deleteMany: {},
            create: encryptedBeneficialOwners,
          },
        }),
      },
    });

    const changes = this.auditService.diff(existing as Record<string, unknown>, dto as Record<string, unknown>);
    if (changes.length > 0) {
      await this.auditService.log({
        coopId,
        entity: 'Shareholder',
        entityId: id,
        action: 'UPDATE',
        changes,
        actorId,
        ipAddress: ip,
        userAgent,
      });
    }

    return this.findById(id, coopId);
  }
}
