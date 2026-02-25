import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { generateOgmCode } from '@opencoop/shared';

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

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
      this.prisma.transaction.findMany({
        where,
        skip,
        take: pageSize,
        include: {
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
          share: { include: { shareClass: true } },
          payment: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.transaction.count({ where }),
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
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        shareholder: true,
        share: { include: { shareClass: true } },
        payment: true,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return transaction;
  }

  async findByShareholder(shareholderId: string) {
    return this.prisma.transaction.findMany({
      where: { shareholderId },
      include: {
        share: { include: { shareClass: true } },
        payment: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPurchase(data: {
    coopId: string;
    shareholderId: string;
    shareClassId: string;
    quantity: number;
    projectId?: string;
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

    // Generate OGM code
    const coop = await this.prisma.coop.findUnique({
      where: { id: data.coopId },
      select: { ogmPrefix: true },
    });

    const paymentCount = await this.prisma.payment.count({
      where: { coopId: data.coopId },
    });
    const ogmCode = generateOgmCode(coop!.ogmPrefix, paymentCount + 1);

    return this.prisma.$transaction(async (tx) => {
      // Create share in PENDING status
      const share = await tx.share.create({
        data: {
          coopId: data.coopId,
          shareholderId: data.shareholderId,
          shareClassId: data.shareClassId,
          projectId: data.projectId || null,
          quantity: data.quantity,
          purchasePricePerShare: pricePerShare,
          purchaseDate: new Date(),
          status: 'PENDING',
        },
      });

      // Create transaction
      const transaction = await tx.transaction.create({
        data: {
          coopId: data.coopId,
          type: 'PURCHASE',
          status: 'PENDING',
          shareholderId: data.shareholderId,
          shareId: share.id,
          quantity: data.quantity,
          pricePerShare,
          totalAmount,
        },
      });

      // Create payment with OGM code
      await tx.payment.create({
        data: {
          coopId: data.coopId,
          transactionId: transaction.id,
          method: 'BANK_TRANSFER',
          status: 'PENDING',
          amount: totalAmount,
          ogmCode,
        },
      });

      return tx.transaction.findUnique({
        where: { id: transaction.id },
        include: {
          shareholder: {
            select: {
              id: true,
              type: true,
              firstName: true,
              lastName: true,
              companyName: true,
            },
          },
          share: { include: { shareClass: true } },
          payment: true,
        },
      });
    });
  }

  async createSale(data: {
    coopId: string;
    shareholderId: string;
    shareId: string;
    quantity: number;
  }) {
    const share = await this.prisma.share.findFirst({
      where: { id: data.shareId, coopId: data.coopId, shareholderId: data.shareholderId },
      include: { shareClass: true },
    });

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    if (share.status !== 'ACTIVE') {
      throw new BadRequestException('Only active shares can be sold');
    }

    // Check for existing pending sell transactions on this share
    const pendingSells = await this.prisma.transaction.aggregate({
      where: {
        shareId: data.shareId,
        type: 'SALE',
        status: { in: ['PENDING', 'APPROVED'] },
      },
      _sum: { quantity: true },
    });

    const pendingQty = pendingSells._sum.quantity || 0;
    if (pendingQty + data.quantity > share.quantity) {
      throw new BadRequestException(
        'Sale quantity plus pending sell requests exceeds available shares',
      );
    }

    const pricePerShare = Number(share.purchasePricePerShare);
    const totalAmount = data.quantity * pricePerShare;

    const transaction = await this.prisma.transaction.create({
      data: {
        coopId: data.coopId,
        type: 'SALE',
        status: 'PENDING',
        shareholderId: data.shareholderId,
        shareId: data.shareId,
        quantity: data.quantity,
        pricePerShare,
        totalAmount,
      },
    });

    return this.prisma.transaction.findUnique({
      where: { id: transaction.id },
      include: {
        shareholder: {
          select: {
            id: true,
            type: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
        share: { include: { shareClass: true } },
        payment: true,
      },
    });
  }

  async approve(id: string, processedByUserId: string) {
    const transaction = await this.findById(id);

    if (transaction.status !== 'PENDING') {
      throw new BadRequestException('Only pending transactions can be approved');
    }

    return this.prisma.$transaction(async (tx) => {
      // Update transaction status
      const updated = await tx.transaction.update({
        where: { id },
        data: {
          status: 'APPROVED',
          processedByUserId,
          processedAt: new Date(),
        },
      });

      if (transaction.type === 'SALE' && transaction.shareId) {
        // For sales: check if full quantity is being sold (including other approved sells)
        const share = await tx.share.findUnique({ where: { id: transaction.shareId } });
        if (share) {
          const allApprovedSells = await tx.transaction.aggregate({
            where: {
              shareId: transaction.shareId,
              type: 'SALE',
              status: 'APPROVED',
            },
            _sum: { quantity: true },
          });

          const totalApproved = allApprovedSells._sum.quantity || 0;
          if (totalApproved >= share.quantity) {
            await tx.share.update({
              where: { id: transaction.shareId },
              data: { status: 'SOLD' },
            });
          }
        }
      } else if (transaction.shareId) {
        // For purchases: activate the share
        await tx.share.update({
          where: { id: transaction.shareId },
          data: { status: 'ACTIVE' },
        });
      }

      return updated;
    });
  }

  async complete(id: string, processedByUserId: string) {
    const transaction = await this.findById(id);

    if (transaction.status !== 'APPROVED') {
      throw new BadRequestException('Only approved transactions can be completed');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          processedByUserId,
          processedAt: new Date(),
        },
      });

      // Mark payment as confirmed if it exists
      if (transaction.payment) {
        await tx.payment.update({
          where: { id: transaction.payment.id },
          data: { status: 'CONFIRMED' },
        });
      }

      return updated;
    });
  }

  async getPaymentDetails(id: string, coopId: string) {
    const transaction = await this.prisma.transaction.findFirst({
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
        share: { include: { shareClass: true } },
        payment: true,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: { name: true, bankIban: true, bankBic: true },
    });

    const shareholderName =
      transaction.shareholder.type === 'COMPANY'
        ? transaction.shareholder.companyName || ''
        : `${transaction.shareholder.firstName || ''} ${transaction.shareholder.lastName || ''}`.trim();

    if (transaction.type === 'PURCHASE') {
      // For purchases: shareholder pays the coop
      return {
        direction: 'incoming' as const,
        beneficiaryName: coop?.name || '',
        iban: coop?.bankIban || '',
        bic: coop?.bankBic || '',
        amount: Number(transaction.totalAmount),
        ogmCode: transaction.payment?.ogmCode || '',
        shareholderName,
      };
    } else {
      // For sales: coop pays the shareholder
      return {
        direction: 'outgoing' as const,
        beneficiaryName: shareholderName,
        iban: transaction.shareholder.bankIban || '',
        bic: transaction.shareholder.bankBic || '',
        amount: Number(transaction.totalAmount),
        ogmCode: transaction.payment?.ogmCode || '',
        shareholderName,
      };
    }
  }

  async reject(id: string, processedByUserId: string, reason: string) {
    const transaction = await this.findById(id);

    if (transaction.status !== 'PENDING') {
      throw new BadRequestException('Only pending transactions can be rejected');
    }

    return this.prisma.transaction.update({
      where: { id },
      data: {
        status: 'REJECTED',
        processedByUserId,
        processedAt: new Date(),
        rejectionReason: reason,
      },
    });
  }

  async createTransfer(data: {
    coopId: string;
    fromShareholderId: string;
    toShareholderId: string;
    shareId: string;
    quantity: number;
    processedByUserId: string;
  }) {
    const share = await this.prisma.share.findUnique({
      where: { id: data.shareId },
      include: { shareClass: true },
    });

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    if (share.shareholderId !== data.fromShareholderId) {
      throw new BadRequestException('Share does not belong to the specified shareholder');
    }

    if (data.quantity > share.quantity) {
      throw new BadRequestException('Transfer quantity exceeds available shares');
    }

    const pricePerShare = Number(share.purchasePricePerShare);
    const totalAmount = data.quantity * pricePerShare;

    return this.prisma.$transaction(async (tx) => {
      // Create transfer-out transaction
      await tx.transaction.create({
        data: {
          coopId: data.coopId,
          type: 'TRANSFER_OUT',
          status: 'COMPLETED',
          shareholderId: data.fromShareholderId,
          shareId: data.shareId,
          quantity: data.quantity,
          pricePerShare,
          totalAmount,
          fromShareholderId: data.fromShareholderId,
          toShareholderId: data.toShareholderId,
          processedByUserId: data.processedByUserId,
          processedAt: new Date(),
        },
      });

      // Create new share for recipient
      const newShare = await tx.share.create({
        data: {
          coopId: data.coopId,
          shareholderId: data.toShareholderId,
          shareClassId: share.shareClassId,
          projectId: share.projectId,
          quantity: data.quantity,
          purchasePricePerShare: pricePerShare,
          purchaseDate: new Date(),
          status: 'ACTIVE',
        },
      });

      // Create transfer-in transaction
      const transferIn = await tx.transaction.create({
        data: {
          coopId: data.coopId,
          type: 'TRANSFER_IN',
          status: 'COMPLETED',
          shareholderId: data.toShareholderId,
          shareId: newShare.id,
          quantity: data.quantity,
          pricePerShare,
          totalAmount,
          fromShareholderId: data.fromShareholderId,
          toShareholderId: data.toShareholderId,
          processedByUserId: data.processedByUserId,
          processedAt: new Date(),
        },
      });

      // Update or deactivate original share
      if (data.quantity === share.quantity) {
        await tx.share.update({
          where: { id: data.shareId },
          data: { status: 'TRANSFERRED' },
        });
      } else {
        await tx.share.update({
          where: { id: data.shareId },
          data: { quantity: share.quantity - data.quantity },
        });
      }

      return transferIn;
    });
  }
}
