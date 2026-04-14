import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateShareholderDto } from './dto/create-shareholder.dto';
import { UpdateShareholderDto } from './dto/update-shareholder.dto';
import { encryptField, decryptField, isEncrypted } from '../../common/crypto';
import { generateReferralCode, computeTotalPaid, computeVestedShares } from '@opencoop/shared';

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
      channelId?: string;
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
    if (params.channelId) where.channelId = params.channelId;
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
        user: { select: { id: true, email: true } },
        registrations: {
          orderBy: { createdAt: 'desc' },
          include: {
            shareClass: true,
            project: true,
            payments: { orderBy: { bankDate: 'asc' } },
            soldBy: {
              where: { type: 'SELL', status: { in: ['PENDING', 'PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] } },
              select: { quantity: true, status: true },
            },
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

    // Compute sharesOwned for BUY registrations, subtracting sold quantities
    const shareholderWithComputed = {
      ...shareholder,
      registrations: shareholder.registrations.map((reg) => {
        if (reg.type === 'BUY') {
          const totalPaid = computeTotalPaid(reg.payments);
          const pricePerShare = Number(reg.pricePerShare);
          const vestedShares = computeVestedShares(totalPaid, pricePerShare, reg.quantity);
          const soldQty = (reg.soldBy ?? []).reduce((sum, s) => sum + s.quantity, 0);
          const sharesOwned = Math.max(0, vestedShares - soldQty);
          return { ...reg, sharesOwned, sharesRemaining: reg.quantity - vestedShares };
        }
        return reg;
      }),
    };

    return this.decryptShareholder(shareholderWithComputed);
  }

  async findMinorsByUserId(userId: string, coopId: string) {
    if (!userId) return [];

    const minors = await this.prisma.shareholder.findMany({
      where: {
        coopId,
        type: 'MINOR',
        registeredByUserId: userId,
      },
      include: {
        registrations: {
          orderBy: { createdAt: 'desc' },
          include: {
            shareClass: true,
            project: true,
            payments: { orderBy: { bankDate: 'asc' } },
            soldBy: {
              where: { type: 'SELL', status: { in: ['PENDING', 'PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] } },
              select: { quantity: true, status: true },
            },
          },
        },
      },
      orderBy: { firstName: 'asc' },
    });

    return minors.map((minor) => ({
      ...minor,
      registrations: minor.registrations.map((reg) => {
        if (reg.type === 'BUY') {
          const totalPaid = computeTotalPaid(reg.payments);
          const pricePerShare = Number(reg.pricePerShare);
          const vestedShares = computeVestedShares(totalPaid, pricePerShare, reg.quantity);
          const soldQty = (reg.soldBy ?? []).reduce((sum, s) => sum + s.quantity, 0);
          const sharesOwned = Math.max(0, vestedShares - soldQty);
          return { ...reg, sharesOwned, sharesRemaining: reg.quantity - vestedShares };
        }
        return reg;
      }),
    }));
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

    // birthDate is required for MINOR shareholders
    if (dto.type === 'MINOR' && !dto.birthDate) {
      throw new BadRequestException('birthDate is required for MINOR shareholders');
    }

    const { beneficialOwners, birthDate, address, ...rest } = dto;

    // Encrypt nationalId fields before storage
    const nationalId = rest.nationalId ? encryptField(rest.nationalId) : rest.nationalId;
    const encryptedBeneficialOwners = beneficialOwners?.map((bo) => ({
      ...bo,
      nationalId: bo.nationalId ? encryptField(bo.nationalId) : bo.nationalId,
    }));

    // Generate unique referral code (retry on collision, including DB-level unique constraint)
    let referralCode: string | null = null;
    for (let i = 0; i < 5; i++) {
      const candidate = generateReferralCode(rest.firstName);
      const existing = await this.prisma.shareholder.findFirst({ where: { referralCode: candidate } });
      if (!existing) {
        referralCode = candidate;
        break;
      }
    }

    let created;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        created = await this.prisma.shareholder.create({
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
        break;
      } catch (err: any) {
        // Retry on unique constraint violation for referralCode
        if (err?.code === 'P2002' && err?.meta?.target?.includes('referralCode') && attempt < 2) {
          referralCode = generateReferralCode(rest.firstName);
          continue;
        }
        throw err;
      }
    }

    await this.auditService.log({
      coopId,
      entity: 'Shareholder',
      entityId: created!.id,
      action: 'CREATE',
      changes: [{ field: '_created', oldValue: null, newValue: dto.type }],
      actorId,
      ipAddress: ip,
      userAgent,
    });

    return this.decryptShareholder(created!);
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
        select: { userId: true },
      });
      const sameHousehold = emailTaken?.userId && emailTaken.userId === existing.userId;
      if (emailTaken && !sameHousehold) {
        throw new ConflictException(
          'A shareholder with this email already exists in this cooperative (different household)',
        );
      }
    }

    // Reject Ecopower fields if the feature is disabled for this coop
    if (dto.isEcoPowerClient !== undefined || dto.ecoPowerId !== undefined) {
      const coop = await this.prisma.coop.findUnique({ where: { id: coopId }, select: { ecoPowerEnabled: true } });
      if (!coop?.ecoPowerEnabled) {
        throw new BadRequestException('Ecopower integration is not enabled for this cooperative');
      }
    }

    const { beneficialOwners, birthDate, address, registeredByUserId, registeredByShareholderId, ...rest } = dto;

    // birthDate is required for MINOR shareholders
    const effectiveType = rest.type || existing.type;
    const effectiveBirthDate = birthDate !== undefined ? birthDate : existing.birthDate;
    if (effectiveType === 'MINOR' && !effectiveBirthDate) {
      throw new BadRequestException('birthDate is required for MINOR shareholders');
    }

    // Handle type change to MINOR: validate parent and clear userId
    const typeChangingToMinor = rest.type === 'MINOR' && existing.type !== 'MINOR';
    const typeChangingFromMinor = rest.type && rest.type !== 'MINOR' && existing.type === 'MINOR';

    let resolvedRegisteredByUserId = registeredByUserId;

    if (registeredByShareholderId) {
      if (registeredByShareholderId === id) {
        throw new BadRequestException('A shareholder cannot be their own parent/guardian');
      }

      const parentShareholder = await this.prisma.shareholder.findFirst({
        where: { id: registeredByShareholderId, coopId },
        select: { id: true, userId: true, email: true, firstName: true, lastName: true },
      });
      if (!parentShareholder) {
        throw new BadRequestException('Parent/guardian shareholder not found');
      }

      if (parentShareholder.userId) {
        resolvedRegisteredByUserId = parentShareholder.userId;
      } else {
        const parentEmail = parentShareholder.email?.toLowerCase();
        if (!parentEmail) {
          throw new BadRequestException('Parent/guardian must have an email before assigning a minor');
        }

        const parentUser =
          (await this.prisma.user.findUnique({ where: { email: parentEmail } })) ??
          (await this.prisma.user.create({
            data: {
              email: parentEmail,
              name: `${parentShareholder.firstName || ''} ${parentShareholder.lastName || ''}`.trim() || null,
              role: 'SHAREHOLDER',
              preferredLanguage: 'nl',
              emailVerified: new Date(),
            },
          }));

        await this.prisma.shareholder.update({
          where: { id: parentShareholder.id },
          data: { userId: parentUser.id },
        });

        resolvedRegisteredByUserId = parentUser.id;
      }
    }

    if (typeChangingToMinor && !resolvedRegisteredByUserId && !existing.registeredByUserId) {
      throw new BadRequestException('registeredByUserId is required when setting type to MINOR');
    }

    if (resolvedRegisteredByUserId) {
      const parentUser = await this.prisma.user.findUnique({ where: { id: resolvedRegisteredByUserId } });
      if (!parentUser) {
        throw new BadRequestException('Parent/guardian user not found');
      }
    }

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
        ...((registeredByUserId !== undefined || registeredByShareholderId !== undefined) && {
          registeredByUserId: resolvedRegisteredByUserId ?? null,
        }),
        ...(typeChangingToMinor && { userId: null }),
        ...(typeChangingFromMinor && { registeredByUserId: null }),
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
