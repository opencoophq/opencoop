import { Injectable, NotFoundException } from '@nestjs/common';
import { renderToBuffer } from '@react-pdf/renderer';
import {
  AnnualOverviewReport,
  ShareholderRegisterReport,
  CapitalStatementReport,
  ProjectInvestmentReport,
} from '@opencoop/pdf-templates';
import { Prisma } from '@opencoop/database';
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

export interface ProjectCapitalPoint {
  projectId: string | null;
  projectName: string;
  capital: number;
}

export interface CapitalTimelineBucket {
  date: string;
  projects: ProjectCapitalPoint[];
  total: number;
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
  capitalTimeline: CapitalTimelineBucket[];
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
  capitalTimeline: CapitalTimelineBucket[];
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
    // Use registrations + payments for historical accuracy: capital that was
    // later sold must still count for dates when it was active.
    const [result] = await this.prisma.$queryRaw<[{ total: string }]>(Prisma.sql`
      SELECT COALESCE(
        SUM(CASE WHEN r.type = 'BUY' THEN p.amount ELSE -p.amount END),
        0
      )::text AS total
      FROM payments p
      JOIN registrations r ON r.id = p."registrationId"
      WHERE r."coopId" = ${coopId}
        AND r.status IN ('ACTIVE', 'COMPLETED')
        AND p."bankDate" < ${before}
    `);
    return Number(result.total) || 0;
  }

  /**
   * Count active shareholders who had at least one active/completed BUY registration
   * registered before `before`. Uses the earliest registerDate as the effective join
   * date (not shareholder.createdAt, which reflects when the DB record was inserted).
   */
  private async countShareholdersWithSharesBefore(coopId: string, before: Date): Promise<number> {
    const result = await this.prisma.shareholder.count({
      where: {
        coopId,
        status: 'ACTIVE',
        registrations: {
          some: {
            type: 'BUY',
            status: { in: ['ACTIVE', 'COMPLETED'] },
            registerDate: { lt: before },
          },
        },
      },
    });
    return result;
  }

  /**
   * Build a monthly capital timeline broken down by project for the given date range.
   * Returns one bucket per month with cumulative capital per project.
   */
  private async computeCapitalTimelineByProject(
    coopId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<CapitalTimelineBucket[]> {
    // Use registrations + payments for historical accuracy — capital that was
    // later sold must still count for months when it was active.
    const regs = await this.prisma.registration.findMany({
      where: {
        coopId,
        status: { in: ['ACTIVE', 'COMPLETED'] },
      },
      select: {
        id: true,
        type: true,
        totalAmount: true,
        createdAt: true,
        projectId: true,
        project: { select: { name: true } },
        payments: { select: { amount: true, bankDate: true } },
      },
    });

    // Collect unique projects
    const projectMap = new Map<string, string>();
    for (const r of regs) {
      const key = r.projectId ?? '__unassigned__';
      if (!projectMap.has(key)) {
        projectMap.set(key, r.project?.name ?? 'Unassigned');
      }
    }
    const projectKeys = Array.from(projectMap.keys()).sort();

    // Generate month buckets — cap at the current month (don't show future)
    const capNow = new Date();
    const currentMonthEnd = new Date(Date.UTC(capNow.getFullYear(), capNow.getMonth() + 1, 1));
    const cappedEnd = rangeEnd < currentMonthEnd ? rangeEnd : currentMonthEnd;

    const buckets: Date[] = [];
    const cursor = new Date(rangeStart);
    cursor.setUTCDate(1);
    cursor.setUTCHours(0, 0, 0, 0);
    while (cursor < cappedEnd) {
      buckets.push(new Date(cursor));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    // Flatten registrations into individual payment events with project info
    const paymentEvents: { projectKey: string; bankDate: Date; signedAmount: number }[] = [];
    for (const r of regs) {
      const key = r.projectId ?? '__unassigned__';
      const sign = r.type === 'BUY' ? 1 : -1;
      for (const p of r.payments) {
        paymentEvents.push({
          projectKey: key,
          bankDate: p.bankDate,
          signedAmount: sign * Number(p.amount),
        });
      }
    }

    // For each bucket, compute cumulative capital per project
    return buckets.map((bucketDate) => {
      const cutoff = new Date(bucketDate);
      cutoff.setUTCMonth(cutoff.getUTCMonth() + 1);

      const projects: ProjectCapitalPoint[] = projectKeys.map((key) => {
        const capital = paymentEvents
          .filter((e) => e.projectKey === key && e.bankDate < cutoff)
          .reduce((sum, e) => sum + e.signedAmount, 0);

        return {
          projectId: key === '__unassigned__' ? null : key,
          projectName: projectMap.get(key) ?? 'Unassigned',
          capital,
        };
      });

      const total = projects.reduce((sum, p) => sum + p.capital, 0);
      return { date: bucketDate.toISOString(), projects, total };
    });
  }

  // --------------------------------------------------------------------------
  // 1. ANNUAL OVERVIEW
  // --------------------------------------------------------------------------

  async getAnnualOverview(coopId: string, year: number): Promise<AnnualOverview> {
    const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
    const yearEnd = new Date(`${year + 1}-01-01T00:00:00.000Z`);
    // For the current/future year, cap at now so we don't show future data
    const now = new Date();
    const effectiveEnd = yearEnd < now ? yearEnd : now;

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

      // Capital at end of year (or now, if year hasn't ended)
      this.computeCapitalAtDate(coopId, effectiveEnd),

      // Active shareholders with at least one share purchased before year start
      this.countShareholdersWithSharesBefore(coopId, yearStart),

      // Active shareholders with at least one share purchased before year end (or now)
      this.countShareholdersWithSharesBefore(coopId, effectiveEnd),

      // Sum of BUY payments in the year (up to now if current year)
      this.prisma.$queryRaw<[{ total: string }]>(Prisma.sql`
        SELECT COALESCE(SUM(p.amount), 0)::text AS total
        FROM payments p
        JOIN registrations r ON r.id = p."registrationId"
        WHERE r."coopId" = ${coopId}
          AND r.type = 'BUY'
          AND r.status IN ('ACTIVE', 'COMPLETED')
          AND p."bankDate" >= ${yearStart}
          AND p."bankDate" < ${effectiveEnd}
      `),

      // Sum of SELL payments in the year (up to now if current year)
      this.prisma.$queryRaw<[{ total: string }]>(Prisma.sql`
        SELECT COALESCE(SUM(p.amount), 0)::text AS total
        FROM payments p
        JOIN registrations r ON r.id = p."registrationId"
        WHERE r."coopId" = ${coopId}
          AND r.type = 'SELL'
          AND r.status = 'COMPLETED'
          AND p."bankDate" >= ${yearStart}
          AND p."bankDate" < ${effectiveEnd}
      `),

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

    // Per-share-class breakdown using registrations + payments for accurate historical capital
    const shareClassRegs = await this.prisma.registration.findMany({
      where: {
        coopId,
        status: { in: ['ACTIVE', 'COMPLETED'] },
      },
      select: {
        type: true,
        quantity: true,
        shareClassId: true,
        payments: {
          where: { bankDate: { lt: effectiveEnd } },
          select: { amount: true },
        },
      },
    });

    const shareClassBreakdown: ShareClassBreakdown[] = shareClasses.map((sc) => {
      const classRegs = shareClassRegs.filter((r) => r.shareClassId === sc.id);
      const shares = classRegs.reduce((sum, r) => {
        return sum + (r.type === 'BUY' ? r.quantity : -r.quantity);
      }, 0);
      const capital = classRegs.reduce((sum, r) => {
        const paidAmount = r.payments.reduce((pSum, p) => pSum + Number(p.amount), 0);
        return sum + (r.type === 'BUY' ? paidAmount : -paidAmount);
      }, 0);
      return { name: sc.name, code: sc.code, shares, capital };
    });

    // Monthly capital timeline broken down by project
    const capitalTimeline = await this.computeCapitalTimelineByProject(coopId, yearStart, yearEnd);

    return {
      year,
      capitalStart,
      capitalEnd,
      shareholdersStart,
      shareholdersEnd,
      totalPurchases: Number(purchasesAgg[0]?.total) || 0,
      totalSales: Number(salesAgg[0]?.total) || 0,
      totalDividendsGross,
      totalDividendsNet,
      shareClassBreakdown,
      capitalTimeline,
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

    const registrations = await this.prisma.registration.findMany({
      where: {
        coopId,
        status: { in: ['ACTIVE', 'COMPLETED'] },
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
        shareClass: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const movements: CapitalMovement[] = registrations.map((reg) => ({
      date: reg.createdAt,
      type: reg.type,
      shareholderName: this.getShareholderName(reg.shareholder),
      shareClass: reg.shareClass?.name ?? '',
      quantity: reg.quantity,
      amount: Number(reg.totalAmount),
    }));

    // BUYs add capital, SELLs subtract it
    const netMovement = movements.reduce((sum, m) => {
      if (m.type === 'BUY') return sum + m.amount;
      if (m.type === 'SELL') return sum - m.amount;
      return sum;
    }, 0);

    // Monthly capital timeline broken down by project
    const capitalTimeline = await this.computeCapitalTimelineByProject(coopId, fromDate, toDateEnd);

    return {
      openingBalance,
      closingBalance: openingBalance + netMovement,
      movements,
      capitalTimeline,
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
        registrations: {
          where: {
            type: 'BUY',
            status: { in: ['ACTIVE', 'COMPLETED'] },
            ...(cutoff ? { registerDate: { lte: cutoff } } : {}),
          },
          select: {
            quantity: true,
            pricePerShare: true,
            registerDate: true,
            payments: { select: { amount: true } },
          },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { companyName: 'asc' }],
    });

    const entries: ShareholderRegisterEntry[] = shareholders.map((sh) => {
      const shareCount = sh.registrations.reduce((sum, r) => sum + r.quantity, 0);
      const totalValue = sh.registrations.reduce(
        (sum, r) => sum + r.payments.reduce((pSum, p) => pSum + Number(p.amount), 0),
        0,
      );

      // Use earliest registration registerDate as join date (not shareholder.createdAt
      // which reflects DB record insertion time, not actual membership start)
      const joinDate =
        sh.registrations.length > 0
          ? sh.registrations.reduce(
              (earliest, r) => (r.registerDate < earliest ? r.registerDate : earliest),
              sh.registrations[0].registerDate,
            )
          : sh.createdAt;

      return {
        name: this.getShareholderName(sh),
        type: sh.type,
        email: sh.email,
        status: sh.status,
        shareCount,
        totalValue,
        joinDate,
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

  async getProjectInvestment(coopId: string, projectId?: string, projectIds?: string[]): Promise<ProjectInvestment> {
    const projectFilter = projectIds?.length
      ? { id: { in: projectIds } }
      : projectId
        ? { id: projectId }
        : {};

    const projects = await this.prisma.project.findMany({
      where: { coopId, ...projectFilter },
      include: {
        registrations: {
          where: {
            type: 'BUY',
            status: { in: ['ACTIVE', 'COMPLETED'] },
          },
          select: {
            shareholderId: true,
            quantity: true,
            payments: { select: { amount: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Also fetch registrations with no project assigned
    const unassignedRegs = await this.prisma.registration.findMany({
      where: { coopId, type: 'BUY', status: { in: ['ACTIVE', 'COMPLETED'] }, projectId: null },
      select: {
        shareholderId: true,
        quantity: true,
        payments: { select: { amount: true } },
      },
    });

    // Helper to compute capital from registrations with nested payments
    const regCapital = (regs: { payments: { amount: unknown }[] }[]) =>
      regs.reduce((sum, r) => sum + r.payments.reduce((pSum, p) => pSum + Number(p.amount), 0), 0);

    // Total active capital across all projects + unassigned for percentage calculation
    const assignedCapital = projects.reduce((sum, p) => sum + regCapital(p.registrations), 0);
    const unassignedCapital = regCapital(unassignedRegs);
    const totalCapitalAll = assignedCapital + unassignedCapital;

    const entries: ProjectInvestmentEntry[] = projects.map((p) => {
      const totalCapital = regCapital(p.registrations);
      const shareCount = p.registrations.reduce((sum, r) => sum + r.quantity, 0);
      const uniqueShareholders = new Set(p.registrations.map((r) => r.shareholderId)).size;
      const percentage =
        totalCapitalAll > 0 ? (totalCapital / totalCapitalAll) * 100 : 0;

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

    // Add unassigned entry if there are registrations without a project
    if (unassignedRegs.length > 0 && !projectId) {
      const unassignedShareCount = unassignedRegs.reduce((sum, r) => sum + r.quantity, 0);
      const unassignedShareholders = new Set(unassignedRegs.map((r) => r.shareholderId)).size;
      const percentage = totalCapitalAll > 0 ? (unassignedCapital / totalCapitalAll) * 100 : 0;
      entries.push({
        id: 'unassigned',
        name: 'Niet toegewezen',
        type: '-',
        totalCapital: unassignedCapital,
        shareholderCount: unassignedShareholders,
        shareCount: unassignedShareCount,
        percentage: Math.round(percentage * 100) / 100,
      });
    }

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
        const ids = params.projectIds ? params.projectIds.split(',') : undefined;
        const data = await this.getProjectInvestment(coopId, params.projectId, ids);
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
          capitalTimeline: data.capitalTimeline,
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
          capitalTimeline: data.capitalTimeline,
          locale,
        });
        break;
      }

      case 'project-investment': {
        const ids = params.projectIds ? params.projectIds.split(',') : undefined;
        const data = await this.getProjectInvestment(coopId, params.projectId, ids);
        const totalCapital = data.projects.reduce((sum, p) => sum + p.totalCapital, 0);
        element = React.createElement(ProjectInvestmentReport, {
          coopName: coop.name,
          projects: data.projects.map((p) => ({
            name: p.name,
            type: p.type,
            totalCapital: p.totalCapital,
            shareholderCount: p.shareholderCount,
            shareCount: p.shareCount,
            percentage: p.percentage,
          })),
          totalCapital,
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
