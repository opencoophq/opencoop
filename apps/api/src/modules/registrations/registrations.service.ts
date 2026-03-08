import { Injectable, Inject, forwardRef, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { generateOgmCode, computeTotalPaid, computeVestedShares } from '@opencoop/shared';
import { DocumentsService } from '../documents/documents.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class RegistrationsService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => DocumentsService))
    private documentsService: DocumentsService,
    private emailService: EmailService,
  ) {}

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

  // C4: Added coopId for tenant isolation
  async findById(id: string, coopId?: string) {
    const where: Record<string, unknown> = { id };
    if (coopId) where.coopId = coopId;

    const registration = await this.prisma.registration.findFirst({
      where,
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
      const totalPaid = computeTotalPaid(reg.payments);
      const pricePerShare = Number(reg.pricePerShare);
      const vestedShares = computeVestedShares(totalPaid, pricePerShare, reg.quantity);

      // C3: Subtract completed sells linked to this BUY
      return {
        ...reg,
        totalPaid,
        sharesOwned: vestedShares,
        sharesRemaining: reg.quantity - vestedShares,
        fullyPaid: totalPaid >= Number(reg.totalAmount),
      };
    });
  }

  /**
   * Compute available shares for a BUY registration, accounting for
   * both pending and completed sells/transfers.
   */
  private async getAvailableShares(registrationId: string, payments: { amount: number | string | { toString(): string } }[], pricePerShare: number, quantity: number): Promise<number> {
    const totalPaid = computeTotalPaid(payments);
    const vestedShares = computeVestedShares(totalPaid, pricePerShare, quantity);

    // C3: Include completed sells too, not just pending
    const existingSells = await this.prisma.registration.aggregate({
      where: {
        sellsRegistrationId: registrationId,
        type: 'SELL',
        status: { in: ['PENDING', 'PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] },
      },
      _sum: { quantity: true },
    });

    const soldQty = existingSells._sum.quantity || 0;
    return vestedShares - soldQty;
  }

  async createBuy(data: {
    coopId: string;
    shareholderId: string;
    shareClassId: string;
    quantity: number;
    projectId?: string;
    isSavings?: boolean;
    channelId?: string;
    isGift?: boolean;
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

    // C6: Guard against null coop
    const coop = await this.prisma.coop.findUnique({
      where: { id: data.coopId },
      select: { ogmPrefix: true, requiresApproval: true },
    });

    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    // I2: Wrap count+create in transaction for OGM uniqueness
    return this.prisma.$transaction(async (tx) => {
      const registrationCount = await tx.registration.count({
        where: { coopId: data.coopId },
      });
      const ogmCode = generateOgmCode(coop.ogmPrefix, registrationCount + 1);

      const initialStatus = coop.requiresApproval ? 'PENDING' : 'PENDING_PAYMENT';

      return tx.registration.create({
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
          isGift: data.isGift || false,
          ogmCode,
          channelId: data.channelId || null,
        },
        include: this.defaultInclude,
      });
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
        // I8: Only allow selling against active/completed buys
        status: { in: ['ACTIVE', 'COMPLETED'] },
      },
      include: { shareClass: true, payments: true },
    });

    if (!buyRegistration) {
      throw new NotFoundException('Active buy registration not found');
    }

    const pricePerShare = Number(buyRegistration.pricePerShare);

    // C3: Check available shares (vested minus all existing sells)
    const available = await this.getAvailableShares(
      data.registrationId,
      buyRegistration.payments,
      pricePerShare,
      buyRegistration.quantity,
    );

    if (data.quantity > available) {
      throw new BadRequestException(
        'Sale quantity exceeds available shares (accounting for pending and completed sells)',
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

  // C4: Added coopId for tenant isolation
  async approve(id: string, coopId: string, processedByUserId: string) {
    const registration = await this.findById(id, coopId);

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

  async complete(id: string, processedByUserId: string, paymentDate?: Date, coopId?: string) {
    const registration = await this.findById(id, coopId);

    if (
      registration.status !== 'PENDING_PAYMENT' &&
      registration.status !== 'ACTIVE'
    ) {
      throw new BadRequestException(
        'Only pending_payment or active registrations can be completed',
      );
    }

    const bankDate = paymentDate || new Date();
    const totalPaid = computeTotalPaid(registration.payments);
    const remaining = Number(registration.totalAmount) - totalPaid;

    const result = await this.prisma.$transaction(async (tx) => {
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

    // Generate gift code if this is a gift registration
    await this.onRegistrationCompleted(id);

    return result;
  }

  // C4: Added coopId for tenant isolation
  async reject(id: string, coopId: string, processedByUserId: string, reason: string) {
    const registration = await this.findById(id, coopId);

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
      // S4: Throw if coop bank details not configured
      if (!coop?.bankIban) {
        throw new BadRequestException('Cooperative bank account (IBAN) must be configured before generating payment details');
      }

      return {
        direction: 'incoming' as const,
        beneficiaryName: coop.name || '',
        iban: coop.bankIban,
        bic: coop.bankBic || '',
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
        // I8: Only allow transfers from active/completed buys
        status: { in: ['ACTIVE', 'COMPLETED'] },
      },
      include: { shareClass: true, payments: true },
    });

    if (!buyRegistration) {
      throw new NotFoundException('Active buy registration not found');
    }

    const pricePerShare = Number(buyRegistration.pricePerShare);

    // I7: Check available shares (vested minus pending/completed sells)
    const available = await this.getAvailableShares(
      data.registrationId,
      buyRegistration.payments,
      pricePerShare,
      buyRegistration.quantity,
    );

    if (data.quantity > available) {
      throw new BadRequestException('Transfer quantity exceeds available shares');
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

  /**
   * Generate a unique gift code in format XXXX-XXXX.
   * Uses 30-char alphabet (A-Z, 2-9, excluding ambiguous 0/O/I/1/L).
   */
  private async generateGiftCode(): Promise<string> {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const maxAttempts = 10;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let code = '';
      for (let i = 0; i < 8; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      code = code.slice(0, 4) + '-' + code.slice(4);

      const existing = await this.prisma.registration.findUnique({
        where: { giftCode: code },
      });
      if (!existing) return code;
    }

    throw new Error('Failed to generate unique gift code after 10 attempts');
  }

  /**
   * Called after a registration transitions to COMPLETED.
   * If it's a gift registration without a code, generates one,
   * then generates a gift certificate PDF and emails it to the buyer.
   * Returns the generated gift code or null.
   */
  async onRegistrationCompleted(registrationId: string): Promise<string | null> {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        shareholder: true,
        shareClass: true,
        coop: true,
      },
    });

    if (!registration || !registration.isGift || registration.giftCode) {
      return null;
    }

    const giftCode = await this.generateGiftCode();

    await this.prisma.registration.update({
      where: { id: registrationId },
      data: { giftCode },
    });

    // Generate PDF and send email to buyer
    try {
      const pdfPath = await this.documentsService.generateGiftCertificatePdf(registrationId);

      const buyerEmail = registration.shareholder.email;
      if (buyerEmail) {
        const buyerName =
          registration.shareholder.type === 'COMPANY'
            ? registration.shareholder.companyName || ''
            : `${registration.shareholder.firstName || ''} ${registration.shareholder.lastName || ''}`.trim();

        await this.emailService.sendGiftCertificate(registration.coopId, buyerEmail, {
          buyerName,
          coopName: registration.coop.name,
          shareClassName: registration.shareClass.name,
          quantity: registration.quantity,
          totalValue: Number(registration.totalAmount),
          giftCode,
          certificatePath: pdfPath,
        });
      }
    } catch (error) {
      // Log but don't fail — gift code is already saved
      console.error('Failed to generate/send gift certificate:', error);
    }

    return giftCode;
  }
}
