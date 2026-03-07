import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { generateOgmCode } from '@opencoop/shared';

@Injectable()
export class RegistrationsService {
  constructor(private prisma: PrismaService) {}

  private readonly defaultInclude = {
    shareholder: {
      select: {
        id: true,
        type: true,
        firstName: true,
        lastName: true,
        companyName: true,
        email: true,
        bankIban: true,
        bankBic: true,
      },
    },
    shareClass: true,
    project: true,
    payments: { orderBy: { bankDate: 'asc' as const } },
  };

  async findAll(
    coopId: string,
    params: {
      page?: number;
      pageSize?: number;
      status?: string;
      type?: string;
      shareholderId?: string;
    } = {},
  ) {
    const page = Number(params.page) || 1;
    const pageSize = Number(params.pageSize) || 25;
    const { status, type, shareholderId } = params;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = { coopId };
    if (status) where.status = status;
    if (type) where.type = type;
    if (shareholderId) where.shareholderId = shareholderId;

    const [items, total] = await Promise.all([
      this.prisma.registration.findMany({
        where,
        skip,
        take: pageSize,
        include: this.defaultInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.registration.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findById(id: string) {
    const registration = await this.prisma.registration.findUnique({
      where: { id },
      include: {
        shareholder: true,
        shareClass: true,
        project: true,
        payments: { orderBy: { bankDate: 'asc' } },
      },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    return registration;
  }

  async findByShareholder(shareholderId: string, coopId?: string) {
    const where: Record<string, unknown> = { shareholderId };
    if (coopId) where.coopId = coopId;

    return this.prisma.registration.findMany({
      where,
      include: {
        shareClass: true,
        project: true,
        payments: { orderBy: { bankDate: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSharesForShareholder(coopId: string, shareholderId: string) {
    const registrations = await this.prisma.registration.findMany({
      where: {
        coopId,
        shareholderId,
        type: 'BUY',
        status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] },
      },
      include: {
        shareClass: true,
        project: true,
        payments: { orderBy: { bankDate: 'asc' } },
      },
      orderBy: { registerDate: 'desc' },
    });

    return registrations.map((reg) => {
      const totalPaid = reg.payments.reduce(
        (sum, p) => sum + Number(p.amount),
        0,
      );
      const pricePerShare = Number(reg.pricePerShare);
      const sharesOwned = Math.min(
        Math.floor(totalPaid / pricePerShare),
        reg.quantity,
      );

      return {
        ...reg,
        totalPaid,
        sharesOwned,
        sharesRemaining: reg.quantity - sharesOwned,
        fullyPaid: totalPaid >= Number(reg.totalAmount),
      };
    });
  }

  async createBuy(data: {
    coopId: string;
    shareholderId: string;
    shareClassId: string;
    quantity: number;
    projectId?: string;
    isSavings?: boolean;
    channelId?: string;
  }) {
    const shareClass = await this.prisma.shareClass.findFirst({
      where: { id: data.shareClassId, coopId: data.coopId, isActive: true },
    });

    if (!shareClass) {
      throw new NotFoundException('Share class not found');
    }

    const shareholder = await this.prisma.shareholder.findFirst({
      where: { id: data.shareholderId, coopId: data.coopId },
    });

    if (!shareholder) {
      throw new NotFoundException('Shareholder not found');
    }

    if (data.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: data.projectId, coopId: data.coopId, isActive: true },
      });
      if (!project) {
        throw new NotFoundException('Project not found');
      }
    }

    const pricePerShare = Number(shareClass.pricePerShare);
    const totalAmount = data.quantity * pricePerShare;

    const coop = await this.prisma.coop.findUnique({
      where: { id: data.coopId },
      select: { ogmPrefix: true, requiresApproval: true },
    });

    const registrationCount = await this.prisma.registration.count({
      where: { coopId: data.coopId },
    });
    const ogmCode = generateOgmCode(coop!.ogmPrefix, registrationCount + 1);

    const initialStatus = coop!.requiresApproval ? 'PENDING' : 'PENDING_PAYMENT';

    return this.prisma.registration.create({
      data: {
        coopId: data.coopId,
        shareholderId: data.shareholderId,
        shareClassId: data.shareClassId,
        projectId: data.projectId || null,
        type: 'BUY',
        status: initialStatus,
        quantity: data.quantity,
        pricePerShare,
        totalAmount,
        registerDate: new Date(),
        isSavings: data.isSavings || false,
        ogmCode,
        channelId: data.channelId || null,
      },
      include: this.defaultInclude,
    });
  }

  async createSell(data: {
    coopId: string;
    shareholderId: string;
    registrationId: string;
    quantity: number;
  }) {
    const buyRegistration = await this.prisma.registration.findFirst({
      where: {
        id: data.registrationId,
        coopId: data.coopId,
        shareholderId: data.shareholderId,
        type: 'BUY',
      },
      include: { shareClass: true, payments: true },
    });

    if (!buyRegistration) {
      throw new NotFoundException('Buy registration not found');
    }

    // Compute vested shares
    const totalPaid = buyRegistration.payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );
    const pricePerShare = Number(buyRegistration.pricePerShare);
    const sharesOwned = Math.min(
      Math.floor(totalPaid / pricePerShare),
      buyRegistration.quantity,
    );

    // Check for existing pending sell registrations on this buy
    const pendingSells = await this.prisma.registration.aggregate({
      where: {
        sellsRegistrationId: data.registrationId,
        type: 'SELL',
        status: { in: ['PENDING', 'PENDING_PAYMENT'] },
      },
      _sum: { quantity: true },
    });

    const pendingQty = pendingSells._sum.quantity || 0;
    if (pendingQty + data.quantity > sharesOwned) {
      throw new BadRequestException(
        'Sale quantity plus pending sell requests exceeds owned shares',
      );
    }

    const totalAmount = data.quantity * pricePerShare;

    return this.prisma.registration.create({
      data: {
        coopId: data.coopId,
        shareholderId: data.shareholderId,
        shareClassId: buyRegistration.shareClassId,
        projectId: buyRegistration.projectId,
        type: 'SELL',
        status: 'PENDING',
        quantity: data.quantity,
        pricePerShare,
        totalAmount,
        registerDate: new Date(),
        sellsRegistrationId: data.registrationId,
      },
      include: this.defaultInclude,
    });
  }

  async approve(id: string, processedByUserId: string) {
    const registration = await this.findById(id);

    if (registration.status !== 'PENDING') {
      throw new BadRequestException('Only pending registrations can be approved');
    }

    return this.prisma.registration.update({
      where: { id },
      data: {
        status: 'PENDING_PAYMENT',
        processedByUserId,
        processedAt: new Date(),
      },
    });
  }

  async complete(id: string, processedByUserId: string, paymentDate?: Date) {
    const registration = await this.findById(id);

    if (
      registration.status !== 'PENDING_PAYMENT' &&
      registration.status !== 'ACTIVE'
    ) {
      throw new BadRequestException(
        'Only pending_payment or active registrations can be completed',
      );
    }

    const bankDate = paymentDate || new Date();
    const totalPaid = registration.payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );
    const remaining = Number(registration.totalAmount) - totalPaid;

    return this.prisma.$transaction(async (tx) => {
      // Create a payment for the remaining amount
      if (remaining > 0) {
        await tx.payment.create({
          data: {
            registrationId: id,
            coopId: registration.coopId,
            amount: remaining,
            bankDate,
            matchedByUserId: processedByUserId,
            matchedAt: new Date(),
          },
        });
      }

      return tx.registration.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          processedByUserId,
          processedAt: new Date(),
        },
      });
    });
  }

  async reject(id: string, processedByUserId: string, reason: string) {
    const registration = await this.findById(id);

    if (registration.status !== 'PENDING') {
      throw new BadRequestException('Only pending registrations can be rejected');
    }

    return this.prisma.registration.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        processedByUserId,
        processedAt: new Date(),
        rejectionReason: reason,
      },
    });
  }

  async getPaymentDetails(id: string, coopId: string) {
    const registration = await this.prisma.registration.findFirst({
      where: { id, coopId },
      include: {
        shareholder: {
          select: {
            firstName: true,
            lastName: true,
            companyName: true,
            type: true,
            bankIban: true,
            bankBic: true,
          },
        },
        shareClass: true,
        payments: true,
      },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: { name: true, bankIban: true, bankBic: true },
    });

    const shareholderName =
      registration.shareholder.type === 'COMPANY'
        ? registration.shareholder.companyName || ''
        : `${registration.shareholder.firstName || ''} ${registration.shareholder.lastName || ''}`.trim();

    if (registration.type === 'BUY') {
      return {
        direction: 'incoming' as const,
        beneficiaryName: coop?.name || '',
        iban: coop?.bankIban || '',
        bic: coop?.bankBic || '',
        amount: Number(registration.totalAmount),
        ogmCode: registration.ogmCode || '',
        shareholderName,
      };
    } else {
      return {
        direction: 'outgoing' as const,
        beneficiaryName: shareholderName,
        iban: registration.shareholder.bankIban || '',
        bic: registration.shareholder.bankBic || '',
        amount: Number(registration.totalAmount),
        ogmCode: registration.ogmCode || '',
        shareholderName,
      };
    }
  }

  async createTransfer(data: {
    coopId: string;
    fromShareholderId: string;
    toShareholderId: string;
    registrationId: string;
    quantity: number;
    processedByUserId: string;
  }) {
    const buyRegistration = await this.prisma.registration.findFirst({
      where: {
        id: data.registrationId,
        coopId: data.coopId,
        shareholderId: data.fromShareholderId,
        type: 'BUY',
      },
      include: { shareClass: true, payments: true },
    });

    if (!buyRegistration) {
      throw new NotFoundException('Registration not found');
    }

    // Check ownership
    const totalPaid = buyRegistration.payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );
    const pricePerShare = Number(buyRegistration.pricePerShare);
    const sharesOwned = Math.min(
      Math.floor(totalPaid / pricePerShare),
      buyRegistration.quantity,
    );

    if (data.quantity > sharesOwned) {
      throw new BadRequestException('Transfer quantity exceeds owned shares');
    }

    const totalAmount = data.quantity * pricePerShare;
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // SELL registration for the from-shareholder
      const sellReg = await tx.registration.create({
        data: {
          coopId: data.coopId,
          shareholderId: data.fromShareholderId,
          shareClassId: buyRegistration.shareClassId,
          projectId: buyRegistration.projectId,
          type: 'SELL',
          status: 'COMPLETED',
          quantity: data.quantity,
          pricePerShare,
          totalAmount,
          registerDate: now,
          sellsRegistrationId: data.registrationId,
          toShareholderId: data.toShareholderId,
          processedByUserId: data.processedByUserId,
          processedAt: now,
        },
      });

      // Synthetic payment for SELL (so capital calc cancels out)
      await tx.payment.create({
        data: {
          registrationId: sellReg.id,
          coopId: data.coopId,
          amount: totalAmount,
          bankDate: now,
          matchedByUserId: data.processedByUserId,
          matchedAt: now,
        },
      });

      // BUY registration for the to-shareholder
      const transferIn = await tx.registration.create({
        data: {
          coopId: data.coopId,
          shareholderId: data.toShareholderId,
          shareClassId: buyRegistration.shareClassId,
          projectId: buyRegistration.projectId,
          type: 'BUY',
          status: 'COMPLETED',
          quantity: data.quantity,
          pricePerShare,
          totalAmount,
          registerDate: now,
          fromShareholderId: data.fromShareholderId,
          processedByUserId: data.processedByUserId,
          processedAt: now,
        },
      });

      // Synthetic payment for BUY (for ownership derivation)
      await tx.payment.create({
        data: {
          registrationId: transferIn.id,
          coopId: data.coopId,
          amount: totalAmount,
          bankDate: now,
          matchedByUserId: data.processedByUserId,
          matchedAt: now,
        },
      });

      return transferIn;
    });
  }
}
