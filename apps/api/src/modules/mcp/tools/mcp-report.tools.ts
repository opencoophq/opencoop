import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { AnalyticsService } from '../../admin/analytics.service';
import { ReportsService } from '../../admin/reports.service';
import { AuditService } from '../../audit/audit.service';
import { DocumentsService } from '../../documents/documents.service';
import { McpToolkit } from '../mcp-toolkit';

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

export const capitalStatementParameters = z
  .object({
    from: isoDate.optional().describe('Start date filter (ISO 8601, defaults to January 1)'),
    to: isoDate.optional().describe('End date filter (ISO 8601, defaults to today)'),
  })
  .strict();

export const shareholderRegisterParameters = z
  .object({
    date: isoDate.optional().describe('Register cutoff date (ISO 8601)'),
  })
  .strict();

export const dividendSummaryParameters = z
  .object({
    year: z.number().int().optional().describe('Report year (defaults to the current year)'),
  })
  .strict();

export const projectInvestmentParameters = z
  .object({
    projectId: z.string().optional().describe('Optional project ID filter'),
  })
  .strict();

export const shareholdersPerProjectParameters = z
  .object({
    projectId: z.string().min(1).describe('The project ID'),
  })
  .strict();

export const referralAnalyticsParameters = z.object({}).strict();

export const auditLogsParameters = z
  .object({
    entity: z.string().optional().describe('Filter by entity name'),
    entityId: z.string().optional().describe('Filter by entity ID'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
    limit: z.number().int().min(1).max(100).optional().describe('Items per page (default 50)'),
  })
  .strict();

export const shareholderDocumentsParameters = z
  .object({
    shareholderId: z.string().min(1).describe('The shareholder ID'),
  })
  .strict();

export const generateCertificateParameters = z
  .object({
    shareholderId: z.string().min(1).describe('The shareholder ID'),
    locale: z.string().optional().describe('Document locale'),
  })
  .strict();

export const generateDividendStatementParameters = z
  .object({
    shareholderId: z.string().min(1).describe('The shareholder ID'),
    dividendPayoutId: z.string().min(1).describe('The dividend payout ID'),
    locale: z.string().optional().describe('Document locale'),
  })
  .strict();

type CapitalStatementParams = z.infer<typeof capitalStatementParameters>;
type ShareholderRegisterParams = z.infer<typeof shareholderRegisterParameters>;
type DividendSummaryParams = z.infer<typeof dividendSummaryParameters>;
type ProjectInvestmentParams = z.infer<typeof projectInvestmentParameters>;
type ShareholdersPerProjectParams = z.infer<typeof shareholdersPerProjectParameters>;
type AuditLogsParams = z.infer<typeof auditLogsParameters>;
type ShareholderDocumentsParams = z.infer<typeof shareholderDocumentsParameters>;
type GenerateCertificateParams = z.infer<typeof generateCertificateParameters>;
type GenerateDividendStatementParams = z.infer<typeof generateDividendStatementParameters>;

@Injectable()
export class McpReportTools {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly analyticsService: AnalyticsService,
    private readonly documentsService: DocumentsService,
    private readonly auditService: AuditService,
    private readonly toolkit: McpToolkit,
  ) {}

  // Mirrors GET admin/coops/:coopId/reports/capital-statement
  @Tool({
    name: 'get_capital_statement',
    description:
      'Get the capital statement for a date range. Returns opening balance, movements, and closing balance.',
    parameters: capitalStatementParameters,
  })
  async getCapitalStatement(params: CapitalStatementParams) {
    return this.toolkit.run({ permission: 'canViewReports' }, params, async (ctx) => {
      const now = new Date();
      const from = params.from ?? `${now.getFullYear()}-01-01`;
      const to = params.to ?? now.toISOString().split('T')[0];
      return this.reportsService.getCapitalStatement(ctx.coopId, from, to);
    });
  }

  // Mirrors GET admin/coops/:coopId/reports/shareholder-register
  @Tool({
    name: 'get_shareholder_register',
    description:
      'Get the shareholder register, optionally as of a cutoff date. Returns shareholder holdings and registration details.',
    parameters: shareholderRegisterParameters,
  })
  async getShareholderRegister(params: ShareholderRegisterParams) {
    return this.toolkit.run({ permission: 'canViewShareholderRegister' }, params, async (ctx) =>
      this.reportsService.getShareholderRegister(ctx.coopId, params.date),
    );
  }

  // Mirrors GET admin/coops/:coopId/reports/dividend-summary
  @Tool({
    name: 'get_dividend_summary',
    description:
      'Get the dividend summary for a year. Returns the dividend period, payouts, and totals.',
    parameters: dividendSummaryParameters,
  })
  async getDividendSummary(params: DividendSummaryParams) {
    return this.toolkit.run({ permission: 'canViewReports' }, params, async (ctx) => {
      const year = Number(params.year) || new Date().getFullYear();
      return this.reportsService.getDividendSummary(ctx.coopId, year);
    });
  }

  // Mirrors GET admin/coops/:coopId/reports/project-investment
  @Tool({
    name: 'get_project_investment_report',
    description:
      'Get project investment totals, optionally filtered to one project. Returns project capital and shareholder statistics.',
    parameters: projectInvestmentParameters,
  })
  async getProjectInvestment(params: ProjectInvestmentParams) {
    return this.toolkit.run({ permission: 'canViewReports' }, params, async (ctx) =>
      this.reportsService.getProjectInvestment(ctx.coopId, params.projectId),
    );
  }

  // Mirrors GET admin/coops/:coopId/reports/shareholders-per-project
  @Tool({
    name: 'get_shareholders_per_project',
    description:
      'Get the shareholders and share holdings for a project. Returns shareholder and share-class details.',
    parameters: shareholdersPerProjectParameters,
  })
  async getShareholdersPerProject(params: ShareholdersPerProjectParams) {
    return this.toolkit.run({ permission: 'canViewReports' }, params, async (ctx) =>
      this.reportsService.getShareholdersPerProject(ctx.coopId, params.projectId),
    );
  }

  // Mirrors GET admin/coops/:coopId/analytics/referrals
  @Tool({
    name: 'get_referral_analytics',
    description: 'Get referral analytics for the authenticated cooperative.',
    parameters: referralAnalyticsParameters,
  })
  async getReferralAnalytics(params: Record<string, never>) {
    return this.toolkit.run({}, params, async (ctx) =>
      this.analyticsService.getReferralAnalytics(ctx.coopId),
    );
  }

  // Mirrors GET admin/coops/:coopId/audit-logs
  @Tool({
    name: 'list_audit_logs',
    description:
      'List audit logs for the authenticated cooperative with optional entity filters and pagination.',
    parameters: auditLogsParameters,
  })
  async listAuditLogs(params: AuditLogsParams) {
    return this.toolkit.run({}, params, async (ctx) =>
      this.auditService.findByCoop(ctx.coopId, {
        entity: params.entity,
        entityId: params.entityId,
        page: Number(params.page) || 1,
        limit: Number(params.limit) || 50,
      }),
    );
  }

  // Mirrors the documents relation embedded in GET admin/coops/:coopId/shareholders/:id (metadata only)
  @Tool({
    name: 'list_shareholder_documents',
    description:
      'List document metadata for a shareholder. Returns document IDs, types, shareholder IDs, and generation timestamps, not files.',
    parameters: shareholderDocumentsParameters,
  })
  async listShareholderDocuments(params: ShareholderDocumentsParams) {
    return this.toolkit.run({ permission: 'canManageShareholders' }, params, async (ctx) =>
      this.documentsService.getDocuments(params.shareholderId, ctx.coopId),
    );
  }

  // Mirrors POST admin/coops/:coopId/shareholders/:shareholderId/certificate
  @Tool({
    name: 'generate_certificate',
    description:
      'Irreversible: generate a shareholder certificate, write its PDF, and update the registration certificate number. Returns document metadata only, not the PDF.',
    parameters: generateCertificateParameters,
  })
  async generateCertificate(params: GenerateCertificateParams) {
    return this.toolkit.run(
      { permission: 'canManageShareholders', write: true },
      params,
      async (ctx) =>
        this.documentsService.generateCertificate(params.shareholderId, ctx.coopId, params.locale),
    );
  }

  // Mirrors POST admin/coops/:coopId/shareholders/:shareholderId/dividend-statement/:dividendPayoutId
  @Tool({
    name: 'generate_dividend_statement',
    description:
      'Irreversible: generate a dividend statement and write its PDF. Returns document metadata only, not the PDF.',
    parameters: generateDividendStatementParameters,
  })
  async generateDividendStatement(params: GenerateDividendStatementParams) {
    return this.toolkit.run(
      { permission: 'canManageShareholders', write: true },
      params,
      async (ctx) =>
        this.documentsService.generateDividendStatement(
          params.shareholderId,
          params.dividendPayoutId,
          ctx.coopId,
          params.locale,
        ),
    );
  }
}
