import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { DividendsService } from '../../dividends/dividends.service';
import { McpToolkit } from '../mcp-toolkit';

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

export const listDividendPeriodsParameters = z.object({}).strict();

export const getDividendPeriodParameters = z
  .object({
    dividendPeriodId: z.string().describe('The dividend period ID'),
  })
  .strict();

export const createDividendPeriodParameters = z
  .object({
    name: z.string().min(1),
    year: z.number().int().min(2000).max(2100),
    dividendRate: z.number().min(0).max(100),
    withholdingTaxRate: z.number().min(0).max(100).optional(),
    exDividendDate: isoDate,
    paymentDate: isoDate.optional(),
  })
  .strict();

export const calculateDividendsParameters = z
  .object({
    dividendPeriodId: z.string().describe('The dividend period ID'),
  })
  .strict();

export const markDividendsPaidParameters = z
  .object({
    dividendPeriodId: z.string().describe('The dividend period ID'),
    paymentReference: z.string().optional().describe('Optional payment reference'),
  })
  .strict();

export const exportDividendsParameters = z
  .object({
    dividendPeriodId: z.string().describe('The dividend period ID'),
  })
  .strict();

type GetDividendPeriodParams = z.infer<typeof getDividendPeriodParameters>;
type CreateDividendPeriodParams = z.infer<typeof createDividendPeriodParameters>;
type CalculateDividendsParams = z.infer<typeof calculateDividendsParameters>;
type MarkDividendsPaidParams = z.infer<typeof markDividendsPaidParameters>;
type ExportDividendsParams = z.infer<typeof exportDividendsParameters>;

@Injectable()
export class McpDividendTools {
  constructor(
    private readonly dividendsService: DividendsService,
    private readonly toolkit: McpToolkit,
  ) {}

  // Mirrors GET admin/coops/:coopId/dividends
  @Tool({
    name: 'list_dividend_periods',
    description:
      'List dividend periods for the authenticated coop, including payout totals and counts.',
    parameters: listDividendPeriodsParameters,
  })
  async listDividendPeriods(params: z.infer<typeof listDividendPeriodsParameters>) {
    return this.toolkit.run({ permission: 'canManageDividends' }, params, async (ctx) =>
      this.dividendsService.findAll(ctx.coopId),
    );
  }

  // Mirrors GET admin/coops/:coopId/dividends/:id
  @Tool({
    name: 'get_dividend_period',
    description:
      'Get one dividend period and its payout rows, including the shareholder fields returned by the REST route.',
    parameters: getDividendPeriodParameters,
  })
  async getDividendPeriod(params: GetDividendPeriodParams) {
    return this.toolkit.run({ permission: 'canManageDividends' }, params, async (ctx) =>
      this.dividendsService.findById(params.dividendPeriodId, ctx.coopId),
    );
  }

  // Mirrors POST admin/coops/:coopId/dividends
  @Tool({
    name: 'create_dividend_period',
    description: 'Create a dividend period with its rate and ex-dividend and payment dates.',
    parameters: createDividendPeriodParameters,
  })
  async createDividendPeriod(params: CreateDividendPeriodParams) {
    return this.toolkit.run(
      { permission: 'canManageDividends', write: true },
      params,
      async (ctx) =>
        this.dividendsService.create(
          ctx.coopId,
          {
            name: params.name,
            year: params.year,
            dividendRate: params.dividendRate,
            withholdingTaxRate: params.withholdingTaxRate,
            exDividendDate: params.exDividendDate,
            paymentDate: params.paymentDate,
          },
          ctx.audit.userId,
          ctx.audit.ip,
          ctx.audit.userAgent,
        ),
    );
  }

  // Mirrors POST admin/coops/:coopId/dividends/:id/calculate
  @Tool({
    name: 'calculate_dividends',
    description:
      'Calculate gross payout, withholding tax, and net payout amounts for every eligible shareholder as of the ex-dividend date.',
    parameters: calculateDividendsParameters,
  })
  async calculateDividends(params: CalculateDividendsParams) {
    return this.toolkit.run(
      { permission: 'canManageDividends', write: true },
      params,
      async (ctx) =>
        this.dividendsService.calculate(
          params.dividendPeriodId,
          ctx.coopId,
          ctx.audit.userId,
          ctx.audit.ip,
          ctx.audit.userAgent,
        ),
    );
  }

  // Mirrors POST admin/coops/:coopId/dividends/:id/mark-paid
  @Tool({
    name: 'mark_dividends_paid',
    description:
      'Irreversible: mark a dividend period as paid and record its optional payment reference. No REST or MCP action can undo this.',
    parameters: markDividendsPaidParameters,
  })
  async markDividendsPaid(params: MarkDividendsPaidParams) {
    return this.toolkit.run(
      { permission: 'canManageDividends', write: true },
      params,
      async (ctx) =>
        this.dividendsService.markAsPaid(
          params.dividendPeriodId,
          ctx.coopId,
          params.paymentReference,
          ctx.audit.userId,
          ctx.audit.ip,
          ctx.audit.userAgent,
        ),
    );
  }

  // Mirrors GET admin/coops/:coopId/dividends/:id/export
  @Tool({
    name: 'export_dividends',
    description: 'Return the dividend payout CSV in bank-transfer format as plain text.',
    parameters: exportDividendsParameters,
  })
  async exportDividends(params: ExportDividendsParams) {
    return this.toolkit.run({ permission: 'canManageDividends' }, params, async (ctx) =>
      this.dividendsService.exportToCsv(params.dividendPeriodId, ctx.coopId),
    );
  }
}
