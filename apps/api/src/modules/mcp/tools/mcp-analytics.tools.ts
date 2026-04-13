import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { McpAuthStore } from '../mcp-auth.store';
import { AnalyticsService } from '../../admin/analytics.service';
import { ReportsService } from '../../admin/reports.service';

@Injectable()
export class McpAnalyticsTools {
  constructor(
    private readonly auth: McpAuthStore,
    private readonly analyticsService: AnalyticsService,
    private readonly reportsService: ReportsService,
  ) {}

  @Tool({
    name: 'get_capital_timeline',
    description:
      'Get capital over time as a timeline of data points. Each point has the date, cumulative total capital, and net change for that period.',
    parameters: z.object({
      bucket: z
        .enum(['day', 'month', 'quarter', 'year'])
        .optional()
        .describe('Time bucket granularity (default: month)'),
      from: z
        .string()
        .optional()
        .describe('Start date filter (ISO 8601, e.g. 2025-01-01)'),
      to: z
        .string()
        .optional()
        .describe('End date filter (ISO 8601, e.g. 2025-12-31)'),
    }),
  })
  async getCapitalTimeline(params: {
    bucket?: 'day' | 'month' | 'quarter' | 'year';
    from?: string;
    to?: string;
  }) {
    const coopId = this.auth.getCoopId();
    const result = await this.analyticsService.getCapitalTimeline(
      coopId,
      params.bucket || 'month',
      params.from,
      params.to,
    );

    return JSON.stringify(result, null, 2);
  }

  @Tool({
    name: 'get_capital_by_project',
    description:
      'Get capital breakdown by project. Returns each project with its total capital, share count, and percentage of total.',
    parameters: z.object({
      from: z
        .string()
        .optional()
        .describe('Start date filter (ISO 8601, e.g. 2025-01-01)'),
      to: z
        .string()
        .optional()
        .describe('End date filter (ISO 8601, e.g. 2025-12-31)'),
    }),
  })
  async getCapitalByProject(params: { from?: string; to?: string }) {
    const coopId = this.auth.getCoopId();
    const result = await this.analyticsService.getCapitalByProject(
      coopId,
      params.from,
      params.to,
    );

    return JSON.stringify(result, null, 2);
  }

  @Tool({
    name: 'get_shareholder_growth',
    description:
      'Get shareholder growth over time, broken down by type (individual, company, minor) with exits and cumulative total.',
    parameters: z.object({
      bucket: z
        .enum(['day', 'month', 'quarter', 'year'])
        .optional()
        .describe('Time bucket granularity (default: month)'),
      from: z
        .string()
        .optional()
        .describe('Start date filter (ISO 8601, e.g. 2025-01-01)'),
      to: z
        .string()
        .optional()
        .describe('End date filter (ISO 8601, e.g. 2025-12-31)'),
    }),
  })
  async getShareholderGrowth(params: {
    bucket?: 'day' | 'month' | 'quarter' | 'year';
    from?: string;
    to?: string;
  }) {
    const coopId = this.auth.getCoopId();
    const result = await this.analyticsService.getShareholderGrowth(
      coopId,
      params.bucket || 'month',
      params.from,
      params.to,
    );

    return JSON.stringify(result, null, 2);
  }

  @Tool({
    name: 'get_transaction_summary',
    description:
      'Get transaction summary over time: number of buys, sells, and total volume per period, plus overall totals.',
    parameters: z.object({
      bucket: z
        .enum(['day', 'month', 'quarter', 'year'])
        .optional()
        .describe('Time bucket granularity (default: month)'),
      from: z
        .string()
        .optional()
        .describe('Start date filter (ISO 8601, e.g. 2025-01-01)'),
      to: z
        .string()
        .optional()
        .describe('End date filter (ISO 8601, e.g. 2025-12-31)'),
    }),
  })
  async getTransactionSummary(params: {
    bucket?: 'day' | 'month' | 'quarter' | 'year';
    from?: string;
    to?: string;
  }) {
    const coopId = this.auth.getCoopId();
    const result = await this.analyticsService.getTransactionSummary(
      coopId,
      params.bucket || 'month',
      params.from,
      params.to,
    );

    return JSON.stringify(result, null, 2);
  }

  @Tool({
    name: 'get_annual_overview',
    description:
      'Get a full annual overview for a given year: capital start/end, shareholder counts, purchases, sales, dividends, and share class breakdown.',
    parameters: z.object({
      year: z.number().describe('The year to generate the overview for (e.g. 2025)'),
    }),
  })
  async getAnnualOverview(params: { year: number }) {
    const coopId = this.auth.getCoopId();
    const result = await this.reportsService.getAnnualOverview(
      coopId,
      params.year,
    );

    return JSON.stringify(result, null, 2);
  }
}
