import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { generateOgmCode } from '@opencoop/shared';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async createForTransaction(transactionId: string, coopId: string, amount: number) {
    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: { ogmPrefix: true },
    });

    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    // Generate unique OGM code
    const lastPayment = await this.prisma.payment.findFirst({
      where: { coopId },
      orderBy: { createdAt: 'desc' },
      select: { ogmCode: true },
    });

    let sequence = 1;
    if (lastPayment?.ogmCode) {
      const raw = lastPayment.ogmCode.replace(/[+/]/g, '');
      sequence = parseInt(raw.slice(3, 10), 10) + 1;
    }

    const ogmCode = generateOgmCode(coop.ogmPrefix, sequence);

    return this.prisma.payment.create({
      data: {
        coopId,
        transactionId,
        method: 'BANK_TRANSFER',
        amount,
        ogmCode,
      },
    });
  }

  async findByOgmCode(ogmCode: string) {
    return this.prisma.payment.findUnique({
      where: { ogmCode },
      include: { transaction: true },
    });
  }

  async updateStatus(id: string, status: 'PENDING' | 'MATCHED' | 'CONFIRMED' | 'FAILED') {
    return this.prisma.payment.update({
      where: { id },
      data: { status },
    });
  }

  async findPendingByCoopId(coopId: string) {
    return this.prisma.payment.findMany({
      where: { coopId, status: 'PENDING' },
      include: {
        transaction: {
          include: {
            shareholder: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                companyName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
