import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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

      // If share exists, activate it
      if (transaction.shareId) {
        await tx.share.update({
          where: { id: transaction.shareId },
          data: { status: 'ACTIVE' },
        });
      }

      return updated;
    });
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
