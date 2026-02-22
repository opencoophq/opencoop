import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SharesService {
  constructor(private prisma: PrismaService) {}

  async findByShareholder(shareholderId: string) {
    return this.prisma.share.findMany({
      where: { shareholderId },
      include: {
        shareClass: true,
        project: true,
      },
      orderBy: { purchaseDate: 'desc' },
    });
  }

  async findByCoopAndShareholder(coopId: string, shareholderId: string) {
    return this.prisma.share.findMany({
      where: { coopId, shareholderId },
      include: {
        shareClass: true,
        project: true,
      },
      orderBy: { purchaseDate: 'desc' },
    });
  }

  async create(data: {
    coopId: string;
    shareholderId: string;
    shareClassId: string;
    projectId?: string;
    quantity: number;
    purchasePricePerShare: number;
    purchaseDate: Date;
    status?: 'PENDING' | 'ACTIVE';
  }) {
    return this.prisma.share.create({
      data: {
        coopId: data.coopId,
        shareholderId: data.shareholderId,
        shareClassId: data.shareClassId,
        projectId: data.projectId,
        quantity: data.quantity,
        purchasePricePerShare: data.purchasePricePerShare,
        purchaseDate: data.purchaseDate,
        status: data.status || 'PENDING',
      },
      include: {
        shareClass: true,
        project: true,
      },
    });
  }
}
