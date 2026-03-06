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
  exits: number;
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

interface ExitRow {
  bucket: Date;
  exits: string;
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

  /**
   * Ensure the timeline extends to the current period by appending an empty
   * bucket if the last data point is before today.
   */
  private padToNow<T extends { date: string }>(
    points: T[],
    period: string,
    makeEmpty: (date: string) => T,
  ): T[] {
    if (points.length === 0) return points;

    const now = new Date();
    let currentBucket: Date;
    if (period === 'year') {
      currentBucket = new Date(Date.UTC(now.getFullYear(), 0, 1));
    } else if (period === 'quarter') {
      const q = Math.floor(now.getMonth() / 3) * 3;
      currentBucket = new Date(Date.UTC(now.getFullYear(), q, 1));
    } else {
      currentBucket = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    }

    const lastDate = new Date(points[points.length - 1].date);
    if (lastDate < currentBucket) {
      points.push(makeEmpty(currentBucket.toISOString()));
    }
    return points;
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

    // Use completed transactions: PURCHASE adds capital, SALE subtracts it.
    const rows = since
      ? await this.prisma.$queryRaw<CapitalTimelineRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, "createdAt") AS bucket,
            SUM(CASE WHEN type = 'PURCHASE' THEN "totalAmount"
                     WHEN type = 'SALE'     THEN -"totalAmount"
                     ELSE 0 END)::text AS net_change
          FROM transactions
          WHERE "coopId" = ${coopId}
            AND status = 'COMPLETED'
            AND type IN ('PURCHASE', 'SALE')
            AND "createdAt" >= ${since}
          GROUP BY bucket
          ORDER BY bucket ASC
        `)
      : await this.prisma.$queryRaw<CapitalTimelineRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, "createdAt") AS bucket,
            SUM(CASE WHEN type = 'PURCHASE' THEN "totalAmount"
                     WHEN type = 'SALE'     THEN -"totalAmount"
                     ELSE 0 END)::text AS net_change
          FROM transactions
          WHERE "coopId" = ${coopId}
            AND status = 'COMPLETED'
            AND type IN ('PURCHASE', 'SALE')
          GROUP BY bucket
          ORDER BY bucket ASC
        `);

    // Get the capital that existed BEFORE the period start so the chart
    // doesn't begin at 0 when using a filtered time range.
    let runningTotal = 0;
    if (since) {
      const [pre] = await this.prisma.$queryRaw<[{ total: string }]>(Prisma.sql`
        SELECT COALESCE(SUM(
          CASE WHEN type = 'PURCHASE' THEN "totalAmount"
               WHEN type = 'SALE'     THEN -"totalAmount"
               ELSE 0 END
        ), 0)::text AS total
        FROM transactions
        WHERE "coopId" = ${coopId}
          AND status = 'COMPLETED'
          AND type IN ('PURCHASE', 'SALE')
          AND "createdAt" < ${since}
      `);
      runningTotal = Number(pre.total) || 0;
    }

    const points = rows.map((row) => {
      const netChange = Number(row.net_change) || 0;
      runningTotal += netChange;
      return {
        date: row.bucket.toISOString(),
        totalCapital: runningTotal,
        netChange,
      };
    });

    return this.padToNow(points, period, (date) => ({
      date,
      totalCapital: runningTotal,
      netChange: 0,
    }));
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

    // Joins: earliest share purchaseDate per shareholder (all shareholders,
    // not just ACTIVE — otherwise we'd miss people who joined then left).
    const joinRows = since
      ? await this.prisma.$queryRaw<ShareholderGrowthRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, first_share_date) AS bucket,
            COUNT(*) FILTER (WHERE type = 'INDIVIDUAL')::text AS individual,
            COUNT(*) FILTER (WHERE type = 'COMPANY')::text    AS company,
            COUNT(*) FILTER (WHERE type = 'MINOR')::text      AS minor
          FROM (
            SELECT sh.id, sh.type, MIN(s."purchaseDate") AS first_share_date
            FROM shareholders sh
            INNER JOIN shares s ON s."shareholderId" = sh.id
            WHERE sh."coopId" = ${coopId}
            GROUP BY sh.id, sh.type
          ) sub
          WHERE first_share_date >= ${since}
          GROUP BY bucket
          ORDER BY bucket ASC
        `)
      : await this.prisma.$queryRaw<ShareholderGrowthRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, first_share_date) AS bucket,
            COUNT(*) FILTER (WHERE type = 'INDIVIDUAL')::text AS individual,
            COUNT(*) FILTER (WHERE type = 'COMPANY')::text    AS company,
            COUNT(*) FILTER (WHERE type = 'MINOR')::text      AS minor
          FROM (
            SELECT sh.id, sh.type, MIN(s."purchaseDate") AS first_share_date
            FROM shareholders sh
            INNER JOIN shares s ON s."shareholderId" = sh.id
            WHERE sh."coopId" = ${coopId}
            GROUP BY sh.id, sh.type
          ) sub
          GROUP BY bucket
          ORDER BY bucket ASC
        `);

    // Exits: INACTIVE shareholders bucketed by their last completed SALE date.
    const exitRows = since
      ? await this.prisma.$queryRaw<ExitRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, exit_date) AS bucket,
            COUNT(*)::text AS exits
          FROM (
            SELECT sh.id, MAX(t."createdAt") AS exit_date
            FROM shareholders sh
            INNER JOIN transactions t ON t."shareholderId" = sh.id
              AND t.type = 'SALE' AND t.status = 'COMPLETED'
            WHERE sh."coopId" = ${coopId}
              AND sh.status = 'INACTIVE'
            GROUP BY sh.id
          ) sub
          WHERE exit_date >= ${since}
          GROUP BY bucket
          ORDER BY bucket ASC
        `)
      : await this.prisma.$queryRaw<ExitRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, exit_date) AS bucket,
            COUNT(*)::text AS exits
          FROM (
            SELECT sh.id, MAX(t."createdAt") AS exit_date
            FROM shareholders sh
            INNER JOIN transactions t ON t."shareholderId" = sh.id
              AND t.type = 'SALE' AND t.status = 'COMPLETED'
            WHERE sh."coopId" = ${coopId}
              AND sh.status = 'INACTIVE'
            GROUP BY sh.id
          ) sub
          GROUP BY bucket
          ORDER BY bucket ASC
        `);

    // Merge joins and exits into a single timeline keyed by bucket
    const bucketMap = new Map<string, { individual: number; company: number; minor: number; exits: number }>();
    for (const row of joinRows) {
      const key = row.bucket.toISOString();
      const entry = bucketMap.get(key) ?? { individual: 0, company: 0, minor: 0, exits: 0 };
      entry.individual = Number(row.individual) || 0;
      entry.company = Number(row.company) || 0;
      entry.minor = Number(row.minor) || 0;
      bucketMap.set(key, entry);
    }
    for (const row of exitRows) {
      const key = row.bucket.toISOString();
      const entry = bucketMap.get(key) ?? { individual: 0, company: 0, minor: 0, exits: 0 };
      entry.exits = Number(row.exits) || 0;
      bucketMap.set(key, entry);
    }

    // Pre-period cumulative: joins before period minus exits before period
    let cumulative = 0;
    if (since) {
      const [preJoins] = await this.prisma.$queryRaw<[{ total: string }]>(Prisma.sql`
        SELECT COUNT(DISTINCT sh.id)::text AS total
        FROM shareholders sh
        INNER JOIN shares s ON s."shareholderId" = sh.id
        WHERE sh."coopId" = ${coopId}
          AND (SELECT MIN(s2."purchaseDate") FROM shares s2 WHERE s2."shareholderId" = sh.id) < ${since}
      `);
      const [preExits] = await this.prisma.$queryRaw<[{ total: string }]>(Prisma.sql`
        SELECT COUNT(DISTINCT sh.id)::text AS total
        FROM shareholders sh
        INNER JOIN transactions t ON t."shareholderId" = sh.id
          AND t.type = 'SALE' AND t.status = 'COMPLETED'
        WHERE sh."coopId" = ${coopId}
          AND sh.status = 'INACTIVE'
          AND (SELECT MAX(t2."createdAt") FROM transactions t2 WHERE t2."shareholderId" = sh.id AND t2.type = 'SALE' AND t2.status = 'COMPLETED') < ${since}
      `);
      cumulative = (Number(preJoins.total) || 0) - (Number(preExits.total) || 0);
    }

    // Sort by date and build the result
    const sortedKeys = [...bucketMap.keys()].sort();
    const points: ShareholderGrowthPoint[] = sortedKeys.map((key) => {
      const entry = bucketMap.get(key)!;
      cumulative += entry.individual + entry.company + entry.minor - entry.exits;
      return {
        date: key,
        individual: entry.individual,
        company: entry.company,
        minor: entry.minor,
        exits: entry.exits,
        cumulative,
      };
    });

    return this.padToNow(points, period, (date) => ({
      date,
      individual: 0,
      company: 0,
      minor: 0,
      exits: 0,
      cumulative,
    }));
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

    const timeline: TransactionSummaryPoint[] = this.padToNow(
      rows.map((row) => ({
        date: row.bucket.toISOString(),
        purchases: Number(row.purchases) || 0,
        sales: Number(row.sales) || 0,
        transfers: Number(row.transfers) || 0,
        volume: Number(row.volume) || 0,
      })),
      period,
      (date) => ({ date, purchases: 0, sales: 0, transfers: 0, volume: 0 }),
    );

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
