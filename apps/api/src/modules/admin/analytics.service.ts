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
  buys: number;
  sells: number;
  volume: number;
}

export interface TransactionSummaryResult {
  timeline: TransactionSummaryPoint[];
  totals: {
    buys: number;
    sells: number;
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
  buys: string;
  sells: string;
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
   * Fill ALL gaps in a timeline — both between data points and up to the
   * current period. Uses the previous point to carry forward running totals.
   */
  private fillGaps<T extends { date: string }>(
    points: T[],
    period: string,
    makeFill: (date: string, prev: T | null) => T,
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

    // Extend to the last data point if it's beyond the current period
    const lastPointBucket = new Date(points[points.length - 1].date);
    if (lastPointBucket > currentBucket) currentBucket = lastPointBucket;

    const existing = new Map<string, T>();
    for (const p of points) existing.set(p.date, p);

    const result: T[] = [];
    const cursor = new Date(points[0].date);
    let prev: T | null = null;
    while (cursor <= currentBucket) {
      const key = cursor.toISOString();
      const point = existing.get(key) ?? makeFill(key, prev);
      result.push(point);
      prev = point;
      if (period === 'year') cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
      else if (period === 'quarter') cursor.setUTCMonth(cursor.getUTCMonth() + 3);
      else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return result;
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

    // Use completed registrations + payments: BUY adds capital, SELL subtracts it.
    const rows = since
      ? await this.prisma.$queryRaw<CapitalTimelineRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, p."bankDate") AS bucket,
            SUM(CASE WHEN r.type = 'BUY' THEN p.amount ELSE -p.amount END)::text AS net_change
          FROM payments p
          JOIN registrations r ON r.id = p."registrationId"
          WHERE r."coopId" = ${coopId}
            AND r.status IN ('ACTIVE', 'COMPLETED')
            AND p."bankDate" >= ${since}
          GROUP BY bucket
          ORDER BY bucket ASC
        `)
      : await this.prisma.$queryRaw<CapitalTimelineRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, p."bankDate") AS bucket,
            SUM(CASE WHEN r.type = 'BUY' THEN p.amount ELSE -p.amount END)::text AS net_change
          FROM payments p
          JOIN registrations r ON r.id = p."registrationId"
          WHERE r."coopId" = ${coopId}
            AND r.status IN ('ACTIVE', 'COMPLETED')
          GROUP BY bucket
          ORDER BY bucket ASC
        `);

    // Get the capital that existed BEFORE the period start so the chart
    // doesn't begin at 0 when using a filtered time range.
    let runningTotal = 0;
    if (since) {
      const [pre] = await this.prisma.$queryRaw<[{ total: string }]>(Prisma.sql`
        SELECT COALESCE(
          SUM(CASE WHEN r.type = 'BUY' THEN p.amount ELSE -p.amount END),
          0
        )::text AS total
        FROM payments p
        JOIN registrations r ON r.id = p."registrationId"
        WHERE r."coopId" = ${coopId}
          AND r.status IN ('ACTIVE', 'COMPLETED')
          AND p."bankDate" < ${since}
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

    return this.fillGaps(points, period, (date, prev) => ({
      date,
      totalCapital: prev?.totalCapital ?? runningTotal,
      netChange: 0,
    }));
  }

  // -------------------------------------------------------------------------
  // 2. Capital by project
  // -------------------------------------------------------------------------

  async getCapitalByProject(coopId: string): Promise<CapitalByProject[]> {
    const rows = await this.prisma.$queryRaw<CapitalByProjectRow[]>(Prisma.sql`
      SELECT
        r."projectId"                  AS project_id,
        proj.name                      AS project_name,
        COALESCE(SUM(CASE WHEN r.type = 'BUY' THEN p.amount ELSE -p.amount END), 0)::text AS total_capital,
        SUM(CASE WHEN r.type = 'BUY' THEN r.quantity
                 WHEN r.type = 'SELL' THEN -r.quantity
                 ELSE 0 END)::text     AS share_count
      FROM registrations r
      LEFT JOIN payments p ON p."registrationId" = r.id
      LEFT JOIN projects proj
        ON proj.id = r."projectId"
        AND proj."coopId" = ${coopId}
      WHERE r."coopId" = ${coopId}
        AND r.status IN ('ACTIVE', 'COMPLETED')
      GROUP BY r."projectId", proj.name
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

    // Joins: earliest BUY registerDate per shareholder (all shareholders,
    // not just ACTIVE — otherwise we'd miss people who joined then left).
    const joinRows = since
      ? await this.prisma.$queryRaw<ShareholderGrowthRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, first_reg_date) AS bucket,
            COUNT(*) FILTER (WHERE type = 'INDIVIDUAL')::text AS individual,
            COUNT(*) FILTER (WHERE type = 'COMPANY')::text    AS company,
            COUNT(*) FILTER (WHERE type = 'MINOR')::text      AS minor
          FROM (
            SELECT sh.id, sh.type, MIN(r."registerDate") AS first_reg_date
            FROM shareholders sh
            INNER JOIN registrations r ON r."shareholderId" = sh.id
              AND r.type = 'BUY' AND r.status IN ('ACTIVE', 'COMPLETED')
            WHERE sh."coopId" = ${coopId}
            GROUP BY sh.id, sh.type
          ) sub
          WHERE first_reg_date >= ${since}
          GROUP BY bucket
          ORDER BY bucket ASC
        `)
      : await this.prisma.$queryRaw<ShareholderGrowthRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, first_reg_date) AS bucket,
            COUNT(*) FILTER (WHERE type = 'INDIVIDUAL')::text AS individual,
            COUNT(*) FILTER (WHERE type = 'COMPANY')::text    AS company,
            COUNT(*) FILTER (WHERE type = 'MINOR')::text      AS minor
          FROM (
            SELECT sh.id, sh.type, MIN(r."registerDate") AS first_reg_date
            FROM shareholders sh
            INNER JOIN registrations r ON r."shareholderId" = sh.id
              AND r.type = 'BUY' AND r.status IN ('ACTIVE', 'COMPLETED')
            WHERE sh."coopId" = ${coopId}
            GROUP BY sh.id, sh.type
          ) sub
          GROUP BY bucket
          ORDER BY bucket ASC
        `);

    // Exits: INACTIVE shareholders bucketed by their last completed SELL date.
    const exitRows = since
      ? await this.prisma.$queryRaw<ExitRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, exit_date) AS bucket,
            COUNT(*)::text AS exits
          FROM (
            SELECT sh.id, MAX(r."createdAt") AS exit_date
            FROM shareholders sh
            INNER JOIN registrations r ON r."shareholderId" = sh.id
              AND r.type = 'SELL' AND r.status = 'COMPLETED'
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
            SELECT sh.id, MAX(r."createdAt") AS exit_date
            FROM shareholders sh
            INNER JOIN registrations r ON r."shareholderId" = sh.id
              AND r.type = 'SELL' AND r.status = 'COMPLETED'
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
        INNER JOIN registrations r ON r."shareholderId" = sh.id
          AND r.type = 'BUY' AND r.status IN ('ACTIVE', 'COMPLETED')
        WHERE sh."coopId" = ${coopId}
          AND (SELECT MIN(r2."registerDate") FROM registrations r2 WHERE r2."shareholderId" = sh.id AND r2.type = 'BUY' AND r2.status IN ('ACTIVE', 'COMPLETED')) < ${since}
      `);
      const [preExits] = await this.prisma.$queryRaw<[{ total: string }]>(Prisma.sql`
        SELECT COUNT(DISTINCT sh.id)::text AS total
        FROM shareholders sh
        INNER JOIN registrations r ON r."shareholderId" = sh.id
          AND r.type = 'SELL' AND r.status = 'COMPLETED'
        WHERE sh."coopId" = ${coopId}
          AND sh.status = 'INACTIVE'
          AND (SELECT MAX(r2."createdAt") FROM registrations r2 WHERE r2."shareholderId" = sh.id AND r2.type = 'SELL' AND r2.status = 'COMPLETED') < ${since}
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

    return this.fillGaps(points, period, (date, prev) => ({
      date,
      individual: 0,
      company: 0,
      minor: 0,
      exits: 0,
      cumulative: prev?.cumulative ?? cumulative,
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

    // S3: Exclude transfer registrations from volume to avoid double-counting
    const rows = since
      ? await this.prisma.$queryRaw<TransactionSummaryRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, r."createdAt") AS bucket,
            COUNT(*) FILTER (WHERE r.type = 'BUY' AND r."fromShareholderId" IS NULL)::text AS buys,
            COUNT(*) FILTER (WHERE r.type = 'SELL' AND r."toShareholderId" IS NULL)::text  AS sells,
            COALESCE(SUM(r."totalAmount") FILTER (WHERE r."fromShareholderId" IS NULL AND r."toShareholderId" IS NULL), 0)::text AS volume
          FROM registrations r
          WHERE r."coopId" = ${coopId}
            AND r.status IN ('ACTIVE', 'COMPLETED')
            AND r."createdAt" >= ${since}
          GROUP BY bucket
          ORDER BY bucket ASC
        `)
      : await this.prisma.$queryRaw<TransactionSummaryRow[]>(Prisma.sql`
          SELECT
            date_trunc(${trunc}, r."createdAt") AS bucket,
            COUNT(*) FILTER (WHERE r.type = 'BUY' AND r."fromShareholderId" IS NULL)::text AS buys,
            COUNT(*) FILTER (WHERE r.type = 'SELL' AND r."toShareholderId" IS NULL)::text  AS sells,
            COALESCE(SUM(r."totalAmount") FILTER (WHERE r."fromShareholderId" IS NULL AND r."toShareholderId" IS NULL), 0)::text AS volume
          FROM registrations r
          WHERE r."coopId" = ${coopId}
            AND r.status IN ('ACTIVE', 'COMPLETED')
          GROUP BY bucket
          ORDER BY bucket ASC
        `);

    const timeline: TransactionSummaryPoint[] = this.fillGaps(
      rows.map((row) => ({
        date: row.bucket.toISOString(),
        buys: Number(row.buys) || 0,
        sells: Number(row.sells) || 0,
        volume: Number(row.volume) || 0,
      })),
      period,
      (date) => ({ date, buys: 0, sells: 0, volume: 0 }),
    );

    const totals = timeline.reduce(
      (acc, point) => ({
        buys: acc.buys + point.buys,
        sells: acc.sells + point.sells,
        volume: acc.volume + point.volume,
      }),
      { buys: 0, sells: 0, volume: 0 },
    );

    return { timeline, totals };
  }
}
