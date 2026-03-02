import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDividendPeriodDto } from './dto/create-dividend-period.dto';
import { calculateDividend } from '@opencoop/shared';

@Injectable()
export class DividendsService {
  constructor(private prisma: PrismaService) {}

  async findAll(coopId: string) {
    const periods = await this.prisma.dividendPeriod.findMany({
      where: { coopId },
      include: {
        payouts: {
          select: {
            grossAmount: true,
            withholdingTax: true,
            netAmount: true,
          },
        },
      },
      orderBy: { year: 'desc' },
    });

    // Calculate totals for each period
    return periods.map((period) => {
      const totals = period.payouts.reduce(
        (acc, payout) => ({
          totalGross: acc.totalGross + Number(payout.grossAmount),
          totalTax: acc.totalTax + Number(payout.withholdingTax),
          totalNet: acc.totalNet + Number(payout.netAmount),
        }),
        { totalGross: 0, totalTax: 0, totalNet: 0 }
      );

      const { payouts, ...periodData } = period;
      return {
        ...periodData,
        ...totals,
        payoutCount: payouts.length,
      };
    });
  }

  async findById(id: string) {
    const period = await this.prisma.dividendPeriod.findUnique({
      where: { id },
      include: {
        payouts: {
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
          },
        },
      },
    });

    if (!period) {
      throw new NotFoundException('Dividend period not found');
    }

    // Calculate totals
    const totals = period.payouts.reduce(
      (acc, payout) => ({
        totalGross: acc.totalGross + Number(payout.grossAmount),
        totalTax: acc.totalTax + Number(payout.withholdingTax),
        totalNet: acc.totalNet + Number(payout.netAmount),
      }),
      { totalGross: 0, totalTax: 0, totalNet: 0 },
    );

    // Map payouts to include shares count and rename fields for frontend
    const payouts = period.payouts.map((payout) => ({
      id: payout.id,
      shareholder: payout.shareholder,
      shares: (payout.calculationDetails as Array<{ quantity: number }>)?.reduce(
        (sum, d) => sum + (d.quantity || 0),
        0,
      ) || 0,
      grossAmount: Number(payout.grossAmount),
      taxAmount: Number(payout.withholdingTax),
      netAmount: Number(payout.netAmount),
    }));

    return {
      id: period.id,
      name: period.name,
      year: period.year,
      exDividendDate: period.exDividendDate,
      paymentDate: period.paymentDate,
      dividendRate: Number(period.dividendRate),
      status: period.status,
      ...totals,
      payouts,
    };
  }

  async create(coopId: string, dto: CreateDividendPeriodDto) {
    // Check if period for year already exists
    const existing = await this.prisma.dividendPeriod.findFirst({
      where: {
        coopId,
        year: dto.year,
      },
    });

    if (existing) {
      throw new ConflictException(`Dividend period for ${dto.year} already exists`);
    }

    // Convert percentage to decimal (e.g., 2.5% -> 0.025)
    const dividendRateDecimal = dto.dividendRate / 100;
    const withholdingTaxRateDecimal = dto.withholdingTaxRate ? dto.withholdingTaxRate / 100 : 0.30;

    return this.prisma.dividendPeriod.create({
      data: {
        coopId,
        name: dto.name,
        year: dto.year,
        dividendRate: dividendRateDecimal,
        withholdingTaxRate: withholdingTaxRateDecimal,
        exDividendDate: new Date(dto.exDividendDate),
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : null,
      },
    });
  }

  async calculate(periodId: string) {
    const period = await this.prisma.dividendPeriod.findUnique({
      where: { id: periodId },
    });

    if (!period) {
      throw new NotFoundException('Dividend period not found');
    }

    if (period.status === 'PAID') {
      throw new BadRequestException('Cannot recalculate paid dividend periods');
    }

    // Get all active shares owned before ex-dividend date
    const eligibleShares = await this.prisma.share.findMany({
      where: {
        coopId: period.coopId,
        status: 'ACTIVE',
        paymentDate: {
          lt: period.exDividendDate,
        },
      },
      include: {
        shareholder: true,
        shareClass: true,
      },
    });

    // Group by shareholder
    const shareholderShares = new Map<string, typeof eligibleShares>();
    for (const share of eligibleShares) {
      const existing = shareholderShares.get(share.shareholderId) || [];
      existing.push(share);
      shareholderShares.set(share.shareholderId, existing);
    }

    // Delete existing payouts for recalculation
    await this.prisma.dividendPayout.deleteMany({
      where: { dividendPeriodId: periodId },
    });

    // Calculate dividends for each shareholder
    const payouts: Array<{
      dividendPeriodId: string;
      shareholderId: string;
      grossAmount: number;
      withholdingTax: number;
      netAmount: number;
      calculationDetails: Array<{
        shareClassId: string;
        shareClassName: string;
        quantity: number;
        pricePerShare: number;
        totalValue: number;
        dividendRate: number;
        dividendAmount: number;
      }>;
    }> = [];
    for (const [shareholderId, shares] of shareholderShares) {
      const calculationDetails: Array<{
        shareClassId: string;
        shareClassName: string;
        quantity: number;
        pricePerShare: number;
        totalValue: number;
        dividendRate: number;
        dividendAmount: number;
      }> = [];
      let totalGross = 0;

      for (const share of shares) {
        const dividendRate = share.shareClass.dividendRateOverride
          ? Number(share.shareClass.dividendRateOverride)
          : Number(period.dividendRate);

        const shareValue = share.quantity * Number(share.purchasePricePerShare);
        const dividend = calculateDividend(
          shareValue,
          dividendRate,
          Number(period.withholdingTaxRate),
        );

        totalGross += dividend.gross;

        calculationDetails.push({
          shareClassId: share.shareClassId,
          shareClassName: share.shareClass.name,
          quantity: share.quantity,
          pricePerShare: Number(share.purchasePricePerShare),
          totalValue: shareValue,
          dividendRate,
          dividendAmount: dividend.gross,
        });
      }

      const totalDividend = calculateDividend(
        totalGross / Number(period.dividendRate), // Reverse calculate principal for total
        Number(period.dividendRate),
        Number(period.withholdingTaxRate),
      );

      // Actually use the sum
      const sumGross = calculationDetails.reduce((sum, d) => sum + d.dividendAmount, 0);
      const tax = sumGross * Number(period.withholdingTaxRate);
      const net = sumGross - tax;

      payouts.push({
        dividendPeriodId: periodId,
        shareholderId,
        grossAmount: sumGross,
        withholdingTax: tax,
        netAmount: net,
        calculationDetails,
      });
    }

    // Create payouts
    await this.prisma.dividendPayout.createMany({
      data: payouts.map((p) => ({
        dividendPeriodId: p.dividendPeriodId,
        shareholderId: p.shareholderId,
        grossAmount: p.grossAmount,
        withholdingTax: p.withholdingTax,
        netAmount: p.netAmount,
        calculationDetails: p.calculationDetails,
      })),
    });

    // Update period status
    await this.prisma.dividendPeriod.update({
      where: { id: periodId },
      data: { status: 'CALCULATED' },
    });

    return this.findById(periodId);
  }

  async markAsPaid(periodId: string, paymentReference?: string) {
    const period = await this.prisma.dividendPeriod.findUnique({
      where: { id: periodId },
    });

    if (!period) {
      throw new NotFoundException('Dividend period not found');
    }

    if (period.status !== 'CALCULATED') {
      throw new BadRequestException('Can only mark calculated periods as paid');
    }

    const now = new Date();

    // Update all payouts
    await this.prisma.dividendPayout.updateMany({
      where: { dividendPeriodId: periodId },
      data: {
        paidAt: now,
        paymentReference,
      },
    });

    // Update period status
    await this.prisma.dividendPeriod.update({
      where: { id: periodId },
      data: { status: 'PAID' },
    });

    return this.findById(periodId);
  }

  async getPayoutsByShareholder(shareholderId: string) {
    return this.prisma.dividendPayout.findMany({
      where: { shareholderId },
      include: {
        dividendPeriod: {
          include: {
            coop: {
              select: {
                id: true,
                slug: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        dividendPeriod: {
          year: 'desc',
        },
      },
    });
  }

  async exportToCsv(periodId: string): Promise<string> {
    const period = await this.prisma.dividendPeriod.findUnique({
      where: { id: periodId },
      include: {
        coop: {
          select: { name: true },
        },
        payouts: {
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
          },
        },
      },
    });

    if (!period) {
      throw new NotFoundException('Dividend period not found');
    }

    if (period.payouts.length === 0) {
      throw new BadRequestException('No payouts to export');
    }

    // CSV header
    const header = [
      'Shareholder ID',
      'Name',
      'Type',
      'Email',
      'Gross Amount',
      'Withholding Tax',
      'Net Amount',
      'Reference',
    ].join(';');

    // CSV rows
    const rows = period.payouts.map((payout) => {
      const name =
        payout.shareholder.type === 'COMPANY'
          ? payout.shareholder.companyName || ''
          : `${payout.shareholder.firstName || ''} ${payout.shareholder.lastName || ''}`.trim();

      const reference = `Dividend ${period.name || period.year} - ${period.coop.name}`;

      return [
        payout.shareholder.id,
        `"${name}"`,
        payout.shareholder.type,
        payout.shareholder.email || '',
        Number(payout.grossAmount).toFixed(2),
        Number(payout.withholdingTax).toFixed(2),
        Number(payout.netAmount).toFixed(2),
        `"${reference}"`,
      ].join(';');
    });

    return [header, ...rows].join('\n');
  }
}
