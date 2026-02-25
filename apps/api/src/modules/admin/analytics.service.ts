import { Injectable } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { PrismaService } from '../../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export interface CapitalTimelinePoint {
  date: string;
  totalCapital: number;
  netChange: number;
}

export interface CapitalByProject {
  projectId: string | null;
  projectName: string;
  totalCapital: number;
  shareCount: number;
  percentage: number;
}

export interface ShareholderGrowthPoint {
  date: string;
  individual: number;
  company: number;
  minor: number;
  cumulative: number;
}

export interface TransactionSummaryPoint {
  date: string;
  purchases: number;
  sales: number;
  transfers: number;
  volume: number;
}

export interface TransactionSummaryResult {
  timeline: TransactionSummaryPoint[];
  totals: {
    purchases: number;
    sales: number;
    transfers: number;
    volume: number;
  };
}

// ---------------------------------------------------------------------------
// Raw query row shapes (all values from pg come back as strings/numbers)
// ---------------------------------------------------------------------------

interface CapitalTimelineRow {
  bucket: Date;
  net_change: string;
}

interface CapitalByProjectRow {
  project_id: string | null;
  project_name: string | null;
  total_capital: string;
  share_count: string;
}

interface ShareholderGrowthRow {
  bucket: Date;
  individual: string;
  company: string;
  minor: string;
}

interface TransactionSummaryRow {
  bucket: Date;
  purchases: string;
  sales: string;
  transfers: string;
  volume: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private getDateRange(period: string): Date | null {
    const now = new Date();
    switch (period) {
      case 'month':
        return new Date(now.getFullYear() - 1, now.getMonth(), 1);
      case 'quarter':
        return new Date(now.getFullYear() - 2, now.getMonth(), 1);
      case 'year':
        return new Date(now.getFullYear() - 10, 0, 1);
      default:
        return null; // 'all'
    }
  }

  private getTrunc(period: string): string {
    return period === 'quarter' ? 'quarter' : period === 'year' ? 'year' : 'month';
  }

  // -------------------------------------------------------------------------
  // 1. Capital timeline
  // -------------------------------------------------------------------------

  async getCapitalTimeline(
    coopId: string,
    period: 'month' | 'quarter' | 'year' | 'all',
  ): Promise<CapitalTimelinePoint[]> {
    const since = this.getDateRange(period);
    const trunc = this.getTrunc(period);

    // Build the date filter clause conditionally so we can use a tagged template.
    // We always filter by coopId + ACTIVE status; the date filter is optional.
    const rows = since
      ? await this.prisma.$queryRaw<CapitalTimelineRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, "purchaseDate") AS bucket,
            SUM(quantity * "purchasePricePerShare")::text AS net_change
          FROM shares
          WHERE "coopId" = ${coopId}
            AND status = 'ACTIVE'
            AND "purchaseDate" >= ${since}
          GROUP BY bucket
          ORDER BY bucket ASC
        `)
      : await this.prisma.$queryRaw<CapitalTimelineRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, "purchaseDate") AS bucket,
            SUM(quantity * "purchasePricePerShare")::text AS net_change
          FROM shares
          WHERE "coopId" = ${coopId}
            AND status = 'ACTIVE'
          GROUP BY bucket
          ORDER BY bucket ASC
        `);

    // Build cumulative running total
    let runningTotal = 0;
    return rows.map((row) => {
      const netChange = Number(row.net_change) || 0;
      runningTotal += netChange;
      return {
        date: row.bucket.toISOString(),
        totalCapital: runningTotal,
        netChange,
      };
    });
  }

  // -------------------------------------------------------------------------
  // 2. Capital by project
  // -------------------------------------------------------------------------

  async getCapitalByProject(coopId: string): Promise<CapitalByProject[]> {
    const rows = await this.prisma.$queryRaw<CapitalByProjectRow[]>(Prisma.sql`
      SELECT
        s."projectId"         AS project_id,
        p.name                AS project_name,
        SUM(s.quantity * s."purchasePricePerShare")::text AS total_capital,
        COUNT(s.id)::text     AS share_count
      FROM shares s
      LEFT JOIN projects p
        ON p.id = s."projectId"
        AND p."coopId" = ${coopId}
      WHERE s."coopId" = ${coopId}
        AND s.status = 'ACTIVE'
      GROUP BY s."projectId", p.name
      ORDER BY total_capital DESC
    `);

    const grandTotal = rows.reduce((sum, r) => sum + (Number(r.total_capital) || 0), 0);

    return rows.map((row) => {
      const totalCapital = Number(row.total_capital) || 0;
      return {
        projectId: row.project_id ?? null,
        projectName: row.project_name ?? 'Unassigned',
        totalCapital,
        shareCount: Number(row.share_count) || 0,
        percentage: grandTotal > 0 ? (totalCapital / grandTotal) * 100 : 0,
      };
    });
  }

  // -------------------------------------------------------------------------
  // 3. Shareholder growth
  // -------------------------------------------------------------------------

  async getShareholderGrowth(
    coopId: string,
    period: 'month' | 'quarter' | 'year' | 'all',
  ): Promise<ShareholderGrowthPoint[]> {
    const since = this.getDateRange(period);
    const trunc = this.getTrunc(period);

    const rows = since
      ? await this.prisma.$queryRaw<ShareholderGrowthRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, "createdAt") AS bucket,
            COUNT(*) FILTER (WHERE type = 'INDIVIDUAL')::text AS individual,
            COUNT(*) FILTER (WHERE type = 'COMPANY')::text    AS company,
            COUNT(*) FILTER (WHERE type = 'MINOR')::text      AS minor
          FROM shareholders
          WHERE "coopId" = ${coopId}
            AND status = 'ACTIVE'
            AND "createdAt" >= ${since}
          GROUP BY bucket
          ORDER BY bucket ASC
        `)
      : await this.prisma.$queryRaw<ShareholderGrowthRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, "createdAt") AS bucket,
            COUNT(*) FILTER (WHERE type = 'INDIVIDUAL')::text AS individual,
            COUNT(*) FILTER (WHERE type = 'COMPANY')::text    AS company,
            COUNT(*) FILTER (WHERE type = 'MINOR')::text      AS minor
          FROM shareholders
          WHERE "coopId" = ${coopId}
            AND status = 'ACTIVE'
          GROUP BY bucket
          ORDER BY bucket ASC
        `);

    let cumulative = 0;
    return rows.map((row) => {
      const individual = Number(row.individual) || 0;
      const company = Number(row.company) || 0;
      const minor = Number(row.minor) || 0;
      cumulative += individual + company + minor;
      return {
        date: row.bucket.toISOString(),
        individual,
        company,
        minor,
        cumulative,
      };
    });
  }

  // -------------------------------------------------------------------------
  // 4. Transaction summary
  // -------------------------------------------------------------------------

  async getTransactionSummary(
    coopId: string,
    period: 'month' | 'quarter' | 'year' | 'all',
  ): Promise<TransactionSummaryResult> {
    const since = this.getDateRange(period);
    const trunc = this.getTrunc(period);

    const rows = since
      ? await this.prisma.$queryRaw<TransactionSummaryRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, "createdAt") AS bucket,
            COUNT(*) FILTER (WHERE type = 'PURCHASE')::text                    AS purchases,
            COUNT(*) FILTER (WHERE type = 'SALE')::text                        AS sales,
            COUNT(*) FILTER (WHERE type = 'TRANSFER_IN')::text                 AS transfers,
            COALESCE(SUM("totalAmount") FILTER (WHERE type != 'TRANSFER_OUT'), 0)::text AS volume
          FROM transactions
          WHERE "coopId" = ${coopId}
            AND status = 'COMPLETED'
            AND "createdAt" >= ${since}
          GROUP BY bucket
          ORDER BY bucket ASC
        `)
      : await this.prisma.$queryRaw<TransactionSummaryRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, "createdAt") AS bucket,
            COUNT(*) FILTER (WHERE type = 'PURCHASE')::text                    AS purchases,
            COUNT(*) FILTER (WHERE type = 'SALE')::text                        AS sales,
            COUNT(*) FILTER (WHERE type = 'TRANSFER_IN')::text                 AS transfers,
            COALESCE(SUM("totalAmount") FILTER (WHERE type != 'TRANSFER_OUT'), 0)::text AS volume
          FROM transactions
          WHERE "coopId" = ${coopId}
            AND status = 'COMPLETED'
          GROUP BY bucket
          ORDER BY bucket ASC
        `);

    const timeline: TransactionSummaryPoint[] = rows.map((row) => ({
      date: row.bucket.toISOString(),
      purchases: Number(row.purchases) || 0,
      sales: Number(row.sales) || 0,
      transfers: Number(row.transfers) || 0,
      volume: Number(row.volume) || 0,
    }));

    const totals = timeline.reduce(
      (acc, point) => ({
        purchases: acc.purchases + point.purchases,
        sales: acc.sales + point.sales,
        transfers: acc.transfers + point.transfers,
        volume: acc.volume + point.volume,
      }),
      { purchases: 0, sales: 0, transfers: 0, volume: 0 },
    );

    return { timeline, totals };
  }
}
