import { Injectable, NotFoundException } from '@nestjs/common';
import { renderToBuffer } from '@react-pdf/renderer';
import {
  AnnualOverviewReport,
  ShareholderRegisterReport,
  CapitalStatementReport,
} from '@opencoop/pdf-templates';
import React from 'react';
import { PrismaService } from '../../prisma/prisma.service';

// ============================================================================
// HELPER TYPES
// ============================================================================

export interface ShareClassBreakdown {
  name: string;
  code: string;
  shares: number;
  capital: number;
}

export interface AnnualOverview {
  year: number;
  capitalStart: number;
  capitalEnd: number;
  shareholdersStart: number;
  shareholdersEnd: number;
  totalPurchases: number;
  totalSales: number;
  totalDividendsGross: number;
  totalDividendsNet: number;
  shareClassBreakdown: ShareClassBreakdown[];
}

export interface CapitalMovement {
  date: Date;
  type: string;
  shareholderName: string;
  shareClass: string;
  quantity: number;
  amount: number;
}

export interface CapitalStatement {
  openingBalance: number;
  closingBalance: number;
  movements: CapitalMovement[];
}

export interface ShareholderRegisterEntry {
  name: string;
  type: string;
  email: string | null;
  status: string;
  shareCount: number;
  totalValue: number;
  joinDate: Date;
}

export interface ShareholderRegister {
  shareholders: ShareholderRegisterEntry[];
}

export interface DividendSummaryPayout {
  shareholderName: string;
  shareCount: number;
  grossAmount: number;
  withholdingTax: number;
  netAmount: number;
}

export interface DividendSummary {
  period: {
    name: string | null;
    year: number;
    dividendRate: number;
    withholdingTaxRate: number;
    status: string;
  };
  totals: {
    gross: number;
    tax: number;
    net: number;
  };
  payouts: DividendSummaryPayout[];
}

export interface ProjectInvestmentEntry {
  id: string;
  name: string;
  type: string;
  totalCapital: number;
  shareholderCount: number;
  shareCount: number;
  percentage: number;
}

export interface ProjectInvestment {
  projects: ProjectInvestmentEntry[];
}

// ============================================================================
// REPORTS SERVICE
// ============================================================================

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private getShareholderName(shareholder: {
    type: string;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
  }): string {
    if (shareholder.type === 'COMPANY') {
      return shareholder.companyName || '';
    }
    return `${shareholder.firstName || ''} ${shareholder.lastName || ''}`.trim();
  }

  private async computeCapitalAtDate(coopId: string, before: Date): Promise<number> {
    const shares = await this.prisma.share.findMany({
      where: {
        coopId,
        status: 'ACTIVE',
        purchaseDate: { lt: before },
      },
      select: {
        quantity: true,
        purchasePricePerShare: true,
      },
    });

    return shares.reduce((sum, s) => sum + s.quantity * s.purchasePricePerShare.toNumber(), 0);
  }

  // --------------------------------------------------------------------------
  // 1. ANNUAL OVERVIEW
  // --------------------------------------------------------------------------

  async getAnnualOverview(coopId: string, year: number): Promise<AnnualOverview> {
    const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
    const yearEnd = new Date(`${year + 1}-01-01T00:00:00.000Z`);

    const [
      capitalStart,
      capitalEnd,
      shareholdersStart,
      shareholdersEnd,
      purchasesAgg,
      salesAgg,
      dividendPeriod,
      shareClasses,
    ] = await Promise.all([
      // Capital at the start of the year
      this.computeCapitalAtDate(coopId, yearStart),

      // Capital at the end of the year
      this.computeCapitalAtDate(coopId, yearEnd),

      // Active shareholders created before the start of the year
      this.prisma.shareholder.count({
        where: {
          coopId,
          status: 'ACTIVE',
          createdAt: { lt: yearStart },
        },
      }),

      // Active shareholders created before the end of the year
      this.prisma.shareholder.count({
        where: {
          coopId,
          status: 'ACTIVE',
          createdAt: { lt: yearEnd },
        },
      }),

      // Sum of COMPLETED PURCHASE transactions in the year
      this.prisma.transaction.aggregate({
        where: {
          coopId,
          type: 'PURCHASE',
          status: 'COMPLETED',
          createdAt: { gte: yearStart, lt: yearEnd },
        },
        _sum: { totalAmount: true },
      }),

      // Sum of COMPLETED SALE transactions in the year
      this.prisma.transaction.aggregate({
        where: {
          coopId,
          type: 'SALE',
          status: 'COMPLETED',
          createdAt: { gte: yearStart, lt: yearEnd },
        },
        _sum: { totalAmount: true },
      }),

      // Dividend period matching the year (with payouts for totals)
      this.prisma.dividendPeriod.findFirst({
        where: { coopId, year },
        include: {
          payouts: {
            select: { grossAmount: true, netAmount: true },
          },
        },
      }),

      // Share classes for breakdown
      this.prisma.shareClass.findMany({
        where: { coopId },
        select: { id: true, name: true, code: true },
      }),
    ]);

    // Dividend totals from payouts
    const totalDividendsGross = dividendPeriod
      ? dividendPeriod.payouts.reduce((sum, p) => sum + p.grossAmount.toNumber(), 0)
      : 0;
    const totalDividendsNet = dividendPeriod
      ? dividendPeriod.payouts.reduce((sum, p) => sum + p.netAmount.toNumber(), 0)
      : 0;

    // Per-share-class breakdown at year end
    const activeSharesAtYearEnd = await this.prisma.share.findMany({
      where: {
        coopId,
        status: 'ACTIVE',
        purchaseDate: { lt: yearEnd },
      },
      select: {
        shareClassId: true,
        quantity: true,
        purchasePricePerShare: true,
      },
    });

    const shareClassBreakdown: ShareClassBreakdown[] = shareClasses.map((sc) => {
      const classShares = activeSharesAtYearEnd.filter((s) => s.shareClassId === sc.id);
      const shares = classShares.reduce((sum, s) => sum + s.quantity, 0);
      const capital = classShares.reduce(
        (sum, s) => sum + s.quantity * s.purchasePricePerShare.toNumber(),
        0,
      );
      return { name: sc.name, code: sc.code, shares, capital };
    });

    return {
      year,
      capitalStart,
      capitalEnd,
      shareholdersStart,
      shareholdersEnd,
      totalPurchases: purchasesAgg._sum.totalAmount?.toNumber() ?? 0,
      totalSales: salesAgg._sum.totalAmount?.toNumber() ?? 0,
      totalDividendsGross,
      totalDividendsNet,
      shareClassBreakdown,
    };
  }

  // --------------------------------------------------------------------------
  // 2. CAPITAL STATEMENT
  // --------------------------------------------------------------------------

  async getCapitalStatement(coopId: string, from: string, to: string): Promise<CapitalStatement> {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    // Include the full to-date day by setting time to end of day
    const toDateEnd = new Date(toDate);
    toDateEnd.setUTCHours(23, 59, 59, 999);

    const openingBalance = await this.computeCapitalAtDate(coopId, fromDate);

    const transactions = await this.prisma.transaction.findMany({
      where: {
        coopId,
        status: 'COMPLETED',
        createdAt: { gte: fromDate, lte: toDateEnd },
      },
      include: {
        shareholder: {
          select: {
            type: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
        share: {
          include: {
            shareClass: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const movements: CapitalMovement[] = transactions.map((tx) => ({
      date: tx.createdAt,
      type: tx.type,
      shareholderName: this.getShareholderName(tx.shareholder),
      shareClass: tx.share?.shareClass?.name ?? '',
      quantity: tx.quantity,
      amount: tx.totalAmount.toNumber(),
    }));

    // Purchases add capital, sales/transfers-out subtract it
    const netMovement = movements.reduce((sum, m) => {
      if (m.type === 'PURCHASE' || m.type === 'TRANSFER_IN') return sum + m.amount;
      if (m.type === 'SALE' || m.type === 'TRANSFER_OUT') return sum - m.amount;
      return sum;
    }, 0);

    return {
      openingBalance,
      closingBalance: openingBalance + netMovement,
      movements,
    };
  }

  // --------------------------------------------------------------------------
  // 3. SHAREHOLDER REGISTER
  // --------------------------------------------------------------------------

  async getShareholderRegister(coopId: string, date?: string): Promise<ShareholderRegister> {
    const cutoff = date ? new Date(date) : undefined;

    const shareholders = await this.prisma.shareholder.findMany({
      where: {
        coopId,
        status: 'ACTIVE',
      },
      include: {
        shares: {
          where: {
            status: 'ACTIVE',
            ...(cutoff ? { purchaseDate: { lte: cutoff } } : {}),
          },
          select: {
            quantity: true,
            purchasePricePerShare: true,
          },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { companyName: 'asc' }],
    });

    const entries: ShareholderRegisterEntry[] = shareholders.map((sh) => {
      const shareCount = sh.shares.reduce((sum, s) => sum + s.quantity, 0);
      const totalValue = sh.shares.reduce(
        (sum, s) => sum + s.quantity * s.purchasePricePerShare.toNumber(),
        0,
      );

      return {
        name: this.getShareholderName(sh),
        type: sh.type,
        email: sh.email,
        status: sh.status,
        shareCount,
        totalValue,
        joinDate: sh.createdAt,
      };
    });

    return { shareholders: entries };
  }

  // --------------------------------------------------------------------------
  // 4. DIVIDEND SUMMARY
  // --------------------------------------------------------------------------

  async getDividendSummary(coopId: string, year: number): Promise<DividendSummary | null> {
    const period = await this.prisma.dividendPeriod.findFirst({
      where: { coopId, year },
      include: {
        payouts: {
          include: {
            shareholder: {
              select: {
                type: true,
                firstName: true,
                lastName: true,
                companyName: true,
              },
            },
          },
        },
      },
    });

    if (!period) {
      return null;
    }

    const totals = period.payouts.reduce(
      (acc, p) => ({
        gross: acc.gross + p.grossAmount.toNumber(),
        tax: acc.tax + p.withholdingTax.toNumber(),
        net: acc.net + p.netAmount.toNumber(),
      }),
      { gross: 0, tax: 0, net: 0 },
    );

    const payouts: DividendSummaryPayout[] = period.payouts.map((p) => {
      const details = p.calculationDetails as Array<{ quantity: number }> | null;
      const shareCount = details ? details.reduce((sum, d) => sum + (d.quantity || 0), 0) : 0;

      return {
        shareholderName: this.getShareholderName(p.shareholder),
        shareCount,
        grossAmount: p.grossAmount.toNumber(),
        withholdingTax: p.withholdingTax.toNumber(),
        netAmount: p.netAmount.toNumber(),
      };
    });

    return {
      period: {
        name: period.name,
        year: period.year,
        dividendRate: period.dividendRate.toNumber(),
        withholdingTaxRate: period.withholdingTaxRate.toNumber(),
        status: period.status,
      },
      totals,
      payouts,
    };
  }

  // --------------------------------------------------------------------------
  // 5. PROJECT INVESTMENT
  // --------------------------------------------------------------------------

  async getProjectInvestment(coopId: string, projectId?: string): Promise<ProjectInvestment> {
    const projectFilter = projectId ? { id: projectId } : {};

    const projects = await this.prisma.project.findMany({
      where: { coopId, ...projectFilter },
      include: {
        shares: {
          where: { status: 'ACTIVE' },
          select: {
            shareholderId: true,
            quantity: true,
            purchasePricePerShare: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Total active capital across all projects for percentage calculation
    const totalCapitalAllProjects = projects.reduce((sum, p) => {
      return (
        sum +
        p.shares.reduce((pSum, s) => pSum + s.quantity * s.purchasePricePerShare.toNumber(), 0)
      );
    }, 0);

    const entries: ProjectInvestmentEntry[] = projects.map((p) => {
      const totalCapital = p.shares.reduce(
        (sum, s) => sum + s.quantity * s.purchasePricePerShare.toNumber(),
        0,
      );
      const shareCount = p.shares.reduce((sum, s) => sum + s.quantity, 0);
      const uniqueShareholders = new Set(p.shares.map((s) => s.shareholderId)).size;
      const percentage =
        totalCapitalAllProjects > 0 ? (totalCapital / totalCapitalAllProjects) * 100 : 0;

      return {
        id: p.id,
        name: p.name,
        type: p.type,
        totalCapital,
        shareholderCount: uniqueShareholders,
        shareCount,
        percentage: Math.round(percentage * 100) / 100,
      };
    });

    return { projects: entries };
  }

  // --------------------------------------------------------------------------
  // 6. CSV GENERATION
  // --------------------------------------------------------------------------

  generateCsv(headers: string[], rows: string[][]): string {
    const escapeField = (field: string): string => {
      if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };

    const headerLine = headers.map(escapeField).join(',');
    const dataLines = rows.map((row) => row.map(escapeField).join(','));

    return [headerLine, ...dataLines].join('\n');
  }

  // --------------------------------------------------------------------------
  // 7. EXPORT REPORT
  // --------------------------------------------------------------------------

  async exportReport(
    coopId: string,
    type: string,
    params: Record<string, string>,
  ): Promise<{ data: unknown; csv: string }> {
    switch (type) {
      case 'annual-overview': {
        const year = parseInt(params.year, 10) || new Date().getFullYear();
        const data = await this.getAnnualOverview(coopId, year);
        const headers = ['Year', 'Capital Start', 'Capital End', 'Shareholders Start', 'Shareholders End', 'Total Purchases', 'Total Sales', 'Dividends Gross', 'Dividends Net'];
        const rows = [
          [
            String(data.year),
            data.capitalStart.toFixed(2),
            data.capitalEnd.toFixed(2),
            String(data.shareholdersStart),
            String(data.shareholdersEnd),
            data.totalPurchases.toFixed(2),
            data.totalSales.toFixed(2),
            data.totalDividendsGross.toFixed(2),
            data.totalDividendsNet.toFixed(2),
          ],
        ];
        return { data, csv: this.generateCsv(headers, rows) };
      }

      case 'capital-statement': {
        const { from, to } = params;
        const data = await this.getCapitalStatement(coopId, from, to);
        const headers = ['Date', 'Type', 'Shareholder', 'Share Class', 'Quantity', 'Amount'];
        const rows = data.movements.map((m) => [
          m.date.toISOString().split('T')[0],
          m.type,
          m.shareholderName,
          m.shareClass,
          String(m.quantity),
          m.amount.toFixed(2),
        ]);
        return { data, csv: this.generateCsv(headers, rows) };
      }

      case 'shareholder-register': {
        const data = await this.getShareholderRegister(coopId, params.date);
        const headers = ['Name', 'Type', 'Email', 'Status', 'Share Count', 'Total Value', 'Join Date'];
        const rows = data.shareholders.map((sh) => [
          sh.name,
          sh.type,
          sh.email ?? '',
          sh.status,
          String(sh.shareCount),
          sh.totalValue.toFixed(2),
          sh.joinDate.toISOString().split('T')[0],
        ]);
        return { data, csv: this.generateCsv(headers, rows) };
      }

      case 'dividend-summary': {
        const year = parseInt(params.year, 10) || new Date().getFullYear();
        const data = await this.getDividendSummary(coopId, year);
        if (!data) {
          return { data: null, csv: this.generateCsv(['No dividend period found for year'], []) };
        }
        const headers = ['Shareholder', 'Share Count', 'Gross Amount', 'Withholding Tax', 'Net Amount'];
        const rows = data.payouts.map((p) => [
          p.shareholderName,
          String(p.shareCount),
          p.grossAmount.toFixed(2),
          p.withholdingTax.toFixed(2),
          p.netAmount.toFixed(2),
        ]);
        return { data, csv: this.generateCsv(headers, rows) };
      }

      case 'project-investment': {
        const data = await this.getProjectInvestment(coopId, params.projectId);
        const headers = ['Project', 'Type', 'Total Capital', 'Shareholders', 'Share Count', 'Percentage'];
        const rows = data.projects.map((p) => [
          p.name,
          p.type,
          p.totalCapital.toFixed(2),
          String(p.shareholderCount),
          String(p.shareCount),
          `${p.percentage.toFixed(2)}%`,
        ]);
        return { data, csv: this.generateCsv(headers, rows) };
      }

      default:
        return { data: null, csv: '' };
    }
  }

  // --------------------------------------------------------------------------
  // 8. PDF GENERATION
  // --------------------------------------------------------------------------

  async generatePdf(
    coopId: string,
    type: string,
    params: Record<string, string>,
  ): Promise<Buffer> {
    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: { name: true },
    });
    if (!coop) throw new NotFoundException('Coop not found');

    const locale = params.locale || 'nl';
    let element: React.ReactElement;

    switch (type) {
      case 'annual-overview': {
        const year = parseInt(params.year, 10) || new Date().getFullYear();
        const data = await this.getAnnualOverview(coopId, year);
        element = React.createElement(AnnualOverviewReport, {
          coopName: coop.name,
          year: data.year,
          capitalStart: data.capitalStart,
          capitalEnd: data.capitalEnd,
          shareholdersStart: data.shareholdersStart,
          shareholdersEnd: data.shareholdersEnd,
          totalPurchases: data.totalPurchases,
          totalSales: data.totalSales,
          totalDividendsGross: data.totalDividendsGross,
          totalDividendsNet: data.totalDividendsNet,
          shareClassBreakdown: data.shareClassBreakdown,
          locale,
        });
        break;
      }

      case 'shareholder-register': {
        const data = await this.getShareholderRegister(coopId, params.date);
        const totalShareCount = data.shareholders.reduce((sum, s) => sum + s.shareCount, 0);
        const totalValue = data.shareholders.reduce((sum, s) => sum + s.totalValue, 0);
        element = React.createElement(ShareholderRegisterReport, {
          coopName: coop.name,
          date: params.date || new Date().toISOString().split('T')[0],
          shareholders: data.shareholders.map((s) => ({
            name: s.name,
            type: s.type,
            email: s.email ?? '',
            shareCount: s.shareCount,
            totalValue: s.totalValue,
            joinDate: s.joinDate.toISOString().split('T')[0],
          })),
          totalShareCount,
          totalValue,
          locale,
        });
        break;
      }

      case 'capital-statement': {
        const now = new Date();
        const from = params.from || `${now.getFullYear()}-01-01`;
        const to = params.to || now.toISOString().split('T')[0];
        const data = await this.getCapitalStatement(coopId, from, to);
        element = React.createElement(CapitalStatementReport, {
          coopName: coop.name,
          fromDate: from,
          toDate: to,
          openingBalance: data.openingBalance,
          closingBalance: data.closingBalance,
          movements: data.movements.map((m) => ({
            date: m.date.toISOString().split('T')[0],
            type: m.type,
            shareholderName: m.shareholderName,
            shareClass: m.shareClass,
            quantity: m.quantity,
            amount: m.amount,
          })),
          locale,
        });
        break;
      }

      default:
        throw new NotFoundException(`PDF export not available for report type: ${type}`);
    }

    return renderToBuffer(element as any) as Promise<Buffer>;
  }
}
