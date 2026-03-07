import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { computeTotalPaid } from '@opencoop/shared';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async findByRegistration(registrationId: string) {
    return this.prisma.payment.findMany({
      where: { registrationId },
      orderBy: { bankDate: 'asc' },
    });
  }

  async findByOgmCode(ogmCode: string) {
    return this.prisma.registration.findUnique({
      where: { ogmCode },
      include: {
        payments: true,
        shareholder: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
      },
    });
  }

  async addPayment(data: {
    registrationId: string;
    coopId: string;
    amount: number;
    bankDate: Date;
    bankTransactionId?: string;
    matchedByUserId?: string;
  }) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: data.registrationId },
      include: { payments: true },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    // I6: Only allow payments on PENDING_PAYMENT or ACTIVE registrations
    if (!['PENDING_PAYMENT', 'ACTIVE'].includes(registration.status)) {
      throw new BadRequestException(
        `Cannot add payment to registration with status ${registration.status}`,
      );
    }

    const payment = await this.prisma.payment.create({
      data: {
        registrationId: data.registrationId,
        coopId: data.coopId,
        amount: data.amount,
        bankDate: data.bankDate,
        bankTransactionId: data.bankTransactionId || null,
        matchedByUserId: data.matchedByUserId || null,
        matchedAt: new Date(),
      },
    });

    // Update registration status based on cumulative payments
    const totalPaid = computeTotalPaid(registration.payments) + data.amount;
    const totalAmount = Number(registration.totalAmount);

    if (totalPaid >= totalAmount) {
      await this.prisma.registration.update({
        where: { id: data.registrationId },
        data: { status: 'COMPLETED' },
      });
    } else if (registration.status === 'PENDING_PAYMENT') {
      // First payment received — mark as ACTIVE (payments in progress)
      await this.prisma.registration.update({
        where: { id: data.registrationId },
        data: { status: 'ACTIVE' },
      });
    }

    return payment;
  }

  async findPendingRegistrationsByCoopId(coopId: string) {
    return this.prisma.registration.findMany({
      where: {
        coopId,
        status: { in: ['PENDING_PAYMENT', 'ACTIVE'] },
        type: 'BUY',
      },
      include: {
        shareholder: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
        shareClass: true,
        payments: { orderBy: { bankDate: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
