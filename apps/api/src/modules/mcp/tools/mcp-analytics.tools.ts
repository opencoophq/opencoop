import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { PrismaService } from '../../../prisma/prisma.service';
import { AnalyticsService } from '../../admin/analytics.service';
import { ReportsService } from '../../admin/reports.service';
import { McpToolkit } from '../mcp-toolkit';

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());
const bucket = z.enum(['day', 'month', 'quarter', 'year']);

export const capitalTimelineParameters = z
  .object({
    bucket: bucket.optional().describe('Time bucket granularity (default: month)'),
    from: isoDate.optional().describe('Start date filter (ISO 8601, e.g. 2025-01-01)'),
    to: isoDate.optional().describe('End date filter (ISO 8601, e.g. 2025-12-31)'),
  })
  .strict();

export const capitalByProjectParameters = z
  .object({
    from: isoDate.optional().describe('Start date filter (ISO 8601, e.g. 2025-01-01)'),
    to: isoDate.optional().describe('End date filter (ISO 8601, e.g. 2025-12-31)'),
  })
  .strict();

export const shareholderGrowthParameters = z
  .object({
    bucket: bucket.optional().describe('Time bucket granularity (default: month)'),
    from: isoDate.optional().describe('Start date filter (ISO 8601, e.g. 2025-01-01)'),
    to: isoDate.optional().describe('End date filter (ISO 8601, e.g. 2025-12-31)'),
  })
  .strict();

export const transactionSummaryParameters = z
  .object({
    bucket: bucket.optional().describe('Time bucket granularity (default: month)'),
    from: isoDate.optional().describe('Start date filter (ISO 8601, e.g. 2025-01-01)'),
    to: isoDate.optional().describe('End date filter (ISO 8601, e.g. 2025-12-31)'),
  })
  .strict();

export const annualOverviewParameters = z
  .object({
    year: z.number().int().min(1900).max(2200).describe('The year to generate the overview for'),
  })
  .strict();

type CapitalTimelineParams = z.infer<typeof capitalTimelineParameters>;
type CapitalByProjectParams = z.infer<typeof capitalByProjectParameters>;
type ShareholderGrowthParams = z.infer<typeof shareholderGrowthParameters>;
type TransactionSummaryParams = z.infer<typeof transactionSummaryParameters>;
type AnnualOverviewParams = z.infer<typeof annualOverviewParameters>;

@Injectable()
export class McpAnalyticsTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analyticsService: AnalyticsService,
    private readonly reportsService: ReportsService,
    private readonly toolkit: McpToolkit,
  ) {}

  private async earliestRegistrationDate(coopId: string): Promise<string | undefined> {
    const earliest = await this.prisma.registration.findFirst({
      where: { coopId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return earliest?.createdAt.toISOString();
  }

  private async earliestPaymentBankDate(coopId: string): Promise<string | undefined> {
    const earliest = await this.prisma.payment.findFirst({
      where: {
        registration: {
          coopId,
          status: { in: ['ACTIVE', 'COMPLETED'] },
        },
      },
      orderBy: { bankDate: 'asc' },
      select: { bankDate: true },
    });
    return earliest?.bankDate.toISOString();
  }

  private async earliestBuyRegisterDate(coopId: string): Promise<string | undefined> {
    const earliest = await this.prisma.registration.findFirst({
      where: {
        coopId,
        type: 'BUY',
        status: { in: ['ACTIVE', 'COMPLETED'] },
      },
      orderBy: { registerDate: 'asc' },
      select: { registerDate: true },
    });
    return earliest?.registerDate.toISOString();
  }

  // Mirrors GET admin/coops/:coopId/analytics/capital-timeline
  @Tool({
    name: 'get_capital_timeline',
    description:
      'Get capital over time as a timeline of data points. Each point has the date, cumulative total capital, and net change for that period.',
    parameters: capitalTimelineParameters,
  })
  async getCapitalTimeline(params: CapitalTimelineParams) {
    return this.toolkit.run({}, params, async (ctx) => {
      const from = params.from ?? (await this.earliestPaymentBankDate(ctx.coopId));
      return this.analyticsService.getCapitalTimeline(
        ctx.coopId,
        params.bucket ?? 'month',
        from,
        params.to,
      );
    });
  }

  // Mirrors GET admin/coops/:coopId/analytics/capital-by-project
  @Tool({
    name: 'get_capital_by_project',
    description:
      'Get capital breakdown by project. Returns each project with its total capital, share count, and percentage of total.',
    parameters: capitalByProjectParameters,
  })
  async getCapitalByProject(params: CapitalByProjectParams) {
    return this.toolkit.run({}, params, async (ctx) =>
      this.analyticsService.getCapitalByProject(ctx.coopId, params.from, params.to),
    );
  }

  // Mirrors GET admin/coops/:coopId/analytics/shareholder-growth
  @Tool({
    name: 'get_shareholder_growth',
    description:
      'Get shareholder growth over time, broken down by type (individual, company, minor) with exits and cumulative total.',
    parameters: shareholderGrowthParameters,
  })
  async getShareholderGrowth(params: ShareholderGrowthParams) {
    return this.toolkit.run({}, params, async (ctx) => {
      const from = params.from ?? (await this.earliestBuyRegisterDate(ctx.coopId));
      return this.analyticsService.getShareholderGrowth(
        ctx.coopId,
        params.bucket ?? 'month',
        from,
        params.to,
      );
    });
  }

  // Mirrors GET admin/coops/:coopId/analytics/transaction-summary
  @Tool({
    name: 'get_transaction_summary',
    description:
      'Get transaction summary over time: number of buys, sells, and total volume per period, plus overall totals.',
    parameters: transactionSummaryParameters,
  })
  async getTransactionSummary(params: TransactionSummaryParams) {
    return this.toolkit.run({}, params, async (ctx) => {
      const from = params.from ?? (await this.earliestRegistrationDate(ctx.coopId));
      return this.analyticsService.getTransactionSummary(
        ctx.coopId,
        params.bucket ?? 'month',
        from,
        params.to,
      );
    });
  }

  // Mirrors GET admin/coops/:coopId/reports/annual-overview
  @Tool({
    name: 'get_annual_overview',
    description:
      'Get a full annual overview for a given year: capital start/end, shareholder counts, purchases, sales, dividends, and share class breakdown.',
    parameters: annualOverviewParameters,
  })
  async getAnnualOverview(params: AnnualOverviewParams) {
    return this.toolkit.run({ permission: 'canViewReports' }, params, async (ctx) =>
      this.reportsService.getAnnualOverview(ctx.coopId, params.year),
    );
  }
}
