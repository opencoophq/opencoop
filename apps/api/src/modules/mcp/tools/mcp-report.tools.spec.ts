import { Test } from '@nestjs/testing';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BillingService } from '../../billing/billing.service';
import { AnalyticsService } from '../../admin/analytics.service';
import { ReportsService } from '../../admin/reports.service';
import { AuditService } from '../../audit/audit.service';
import { DocumentsService } from '../../documents/documents.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import {
  McpReportTools,
  auditLogsParameters,
  capitalStatementParameters,
  dividendSummaryParameters,
  generateCertificateParameters,
  generateDividendStatementParameters,
  projectInvestmentParameters,
  referralAnalyticsParameters,
  shareholderDocumentsParameters,
  shareholderRegisterParameters,
  shareholdersPerProjectParameters,
} from './mcp-report.tools';

jest.mock('../../admin/reports.service', () => ({
  ReportsService: class ReportsService {},
}));
jest.mock('../../admin/analytics.service', () => ({
  AnalyticsService: class AnalyticsService {},
}));
jest.mock('../../documents/documents.service', () => ({
  DocumentsService: class DocumentsService {},
}));
jest.mock('../../audit/audit.service', () => ({
  AuditService: class AuditService {},
}));

describe('McpReportTools', () => {
  let tools: McpReportTools;
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'k1',
    getScope: jest.fn(),
  };
  const permissions = { permissions: jest.fn(), permissionsWithRole: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const reports = {
    getCapitalStatement: jest.fn(),
    getShareholderRegister: jest.fn(),
    getDividendSummary: jest.fn(),
    getProjectInvestment: jest.fn(),
    getShareholdersPerProject: jest.fn(),
  };
  const analytics = { getReferralAnalytics: jest.fn() };
  const documents = {
    getDocuments: jest.fn(),
    generateCertificate: jest.fn(),
    generateDividendStatement: jest.fn(),
  };
  const audit = { findByCoop: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpReportTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: ReportsService, useValue: reports },
        { provide: AnalyticsService, useValue: analytics },
        { provide: DocumentsService, useValue: documents },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    tools = module.get(McpReportTools);
    jest.clearAllMocks();
    permissions.permissionsWithRole.mockImplementation(async () => ({
      permissions: await permissions.permissions(),
      role: 'COOP_ADMIN',
    }));
    auth.getScope.mockReturnValue('READ_WRITE');
    permissions.permissions.mockResolvedValue({
      canViewReports: true,
      canViewShareholderRegister: true,
      canManageShareholders: true,
    });
    billing.isReadOnly.mockResolvedValue(false);
    reports.getCapitalStatement.mockResolvedValue({ openingBalance: 0 });
    reports.getShareholderRegister.mockResolvedValue({ shareholders: [] });
    reports.getDividendSummary.mockResolvedValue({ year: 2025 });
    reports.getProjectInvestment.mockResolvedValue({ projects: [] });
    reports.getShareholdersPerProject.mockResolvedValue({ shareholders: [] });
    analytics.getReferralAnalytics.mockResolvedValue({ totalReferrals: 0 });
    documents.getDocuments.mockResolvedValue([
      {
        id: 'doc-1',
        shareholderId: 'shareholder-1',
        type: 'SHARE_CERTIFICATE',
        filePath: '/tmp/doc.pdf',
      },
    ]);
    documents.generateCertificate.mockResolvedValue({ id: 'doc-2', filePath: '/tmp/cert.pdf' });
    documents.generateDividendStatement.mockResolvedValue({
      id: 'doc-3',
      filePath: '/tmp/dividend.pdf',
    });
    audit.findByCoop.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50, totalPages: 0 });
  });

  it('calls every report, analytics, audit, and document service with the authenticated coop', async () => {
    await tools.getCapitalStatement({ from: '2025-01-01', to: '2025-12-31' });
    await tools.getShareholderRegister({ date: '2025-06-30' });
    await tools.getDividendSummary({ year: 2025 });
    await tools.getProjectInvestment({ projectId: 'project-1' });
    await tools.getShareholdersPerProject({ projectId: 'project-1' });
    await tools.getReferralAnalytics({});
    await tools.listAuditLogs({
      entity: 'Registration',
      entityId: 'registration-1',
      page: 2,
      limit: 25,
    });
    await tools.listShareholderDocuments({ shareholderId: 'shareholder-1' });
    await tools.generateCertificate({ shareholderId: 'shareholder-1', locale: 'nl' });
    await tools.generateDividendStatement({
      shareholderId: 'shareholder-1',
      dividendPayoutId: 'payout-1',
      locale: 'nl',
    });

    expect(reports.getCapitalStatement).toHaveBeenCalledWith(
      'coop-from-auth',
      '2025-01-01',
      '2025-12-31',
    );
    expect(reports.getShareholderRegister).toHaveBeenCalledWith('coop-from-auth', '2025-06-30');
    expect(reports.getDividendSummary).toHaveBeenCalledWith('coop-from-auth', 2025);
    expect(reports.getProjectInvestment).toHaveBeenCalledWith('coop-from-auth', 'project-1');
    expect(reports.getShareholdersPerProject).toHaveBeenCalledWith('coop-from-auth', 'project-1');
    expect(analytics.getReferralAnalytics).toHaveBeenCalledWith('coop-from-auth');
    expect(audit.findByCoop).toHaveBeenCalledWith('coop-from-auth', {
      entity: 'Registration',
      entityId: 'registration-1',
      page: 2,
      limit: 25,
    });
    expect(documents.getDocuments).toHaveBeenCalledWith('shareholder-1', 'coop-from-auth');
    expect(documents.generateCertificate).toHaveBeenCalledWith(
      'shareholder-1',
      'coop-from-auth',
      'nl',
    );
    expect(documents.generateDividendStatement).toHaveBeenCalledWith(
      'shareholder-1',
      'payout-1',
      'coop-from-auth',
      'nl',
    );
  });

  it('applies the REST defaults for capital, dividends, and audit logs', async () => {
    await tools.getCapitalStatement({});
    await tools.getDividendSummary({});
    await tools.listAuditLogs({});

    const now = new Date();
    expect(reports.getCapitalStatement).toHaveBeenCalledWith(
      'coop-from-auth',
      `${now.getFullYear()}-01-01`,
      now.toISOString().split('T')[0],
    );
    expect(reports.getDividendSummary).toHaveBeenCalledWith('coop-from-auth', now.getFullYear());
    expect(audit.findByCoop).toHaveBeenCalledWith('coop-from-auth', {
      entity: undefined,
      entityId: undefined,
      page: 1,
      limit: 50,
    });
  });

  it('masks shareholder register PII when canViewPII is false', async () => {
    permissions.permissions.mockResolvedValue({
      canViewReports: true,
      canViewShareholderRegister: true,
      canViewPII: false,
    });
    reports.getShareholderRegister.mockResolvedValue({
      shareholders: [{ name: 'Ada Lovelace', email: 'ada@example.com', shareCount: 2 }],
    });

    const result = await tools.getShareholderRegister({});

    expect(result).toEqual({
      shareholders: [{ name: 'Aandeelhouder #1', email: '***', shareCount: 2 }],
    });
  });

  it('masks shareholder names in capital statements when canViewPII is false', async () => {
    permissions.permissions.mockResolvedValue({ canViewReports: true, canViewPII: false });
    reports.getCapitalStatement.mockResolvedValue({
      movements: [{ shareholderName: 'Ada Lovelace', amount: 10 }],
    });

    const result = await tools.getCapitalStatement({});

    expect(result).toEqual({
      movements: [{ shareholderName: 'Aandeelhouder #1', amount: 10 }],
    });
  });

  it('masks shareholder-per-project PII when canViewPII is false', async () => {
    permissions.permissions.mockResolvedValue({ canViewReports: true, canViewPII: false });
    reports.getShareholdersPerProject.mockResolvedValue({
      projectId: 'project-1',
      shareholders: [
        {
          shareholderId: 'shareholder-1234',
          shareholderName: 'Ada Lovelace',
          email: 'ada@example.com',
        },
      ],
    });

    const result = await tools.getShareholdersPerProject({ projectId: 'project-1' });

    expect(result).toEqual({
      projectId: 'project-1',
      shareholders: [
        expect.objectContaining({
          shareholderId: 'shareholder-1234',
          shareholderName: 'Aandeelhouder #1234',
          email: '***',
        }),
      ],
    });
  });

  it('masks dividend-summary shareholder names when canViewPII is false', async () => {
    permissions.permissions.mockResolvedValue({ canViewReports: true, canViewPII: false });
    reports.getDividendSummary.mockResolvedValue({
      year: 2025,
      payouts: [{ shareholderName: 'Ada Lovelace', grossAmount: 10 }],
    });

    const result = await tools.getDividendSummary({ year: 2025 });

    expect(result).toEqual({
      year: 2025,
      payouts: [{ shareholderName: 'Aandeelhouder #1', grossAmount: 10 }],
    });
  });

  it('masks referral-analytics shareholder names when canViewPII is false', async () => {
    permissions.permissions.mockResolvedValue({ canViewPII: false });
    analytics.getReferralAnalytics.mockResolvedValue({
      totalReferrals: 1,
      topReferrers: [{ id: 'shareholder-1234', name: 'Ada Lovelace', totalReferred: 1 }],
    });

    const result = await tools.getReferralAnalytics({});

    expect(result).toEqual({
      totalReferrals: 1,
      topReferrers: [{ id: 'shareholder-1234', name: 'Aandeelhouder #1234', totalReferred: 1 }],
    });
  });

  it('rejects both document writes for read-only keys', async () => {
    auth.getScope.mockReturnValue('READ_ONLY');

    await expect(
      tools.generateCertificate({ shareholderId: 'shareholder-1' }),
    ).rejects.toBeInstanceOf(McpError);
    await expect(
      tools.generateDividendStatement({
        shareholderId: 'shareholder-1',
        dividendPayoutId: 'payout-1',
      }),
    ).rejects.toBeInstanceOf(McpError);

    expect(documents.generateCertificate).not.toHaveBeenCalled();
    expect(documents.generateDividendStatement).not.toHaveBeenCalled();
  });

  it('rejects both document writes without canManageShareholders', async () => {
    permissions.permissions.mockResolvedValue({});

    await expect(
      tools.generateCertificate({ shareholderId: 'shareholder-1' }),
    ).rejects.toBeInstanceOf(McpError);
    await expect(
      tools.generateDividendStatement({
        shareholderId: 'shareholder-1',
        dividendPayoutId: 'payout-1',
      }),
    ).rejects.toBeInstanceOf(McpError);

    expect(documents.generateCertificate).not.toHaveBeenCalled();
    expect(documents.generateDividendStatement).not.toHaveBeenCalled();
  });

  it('rejects invalid input for every tool schema', () => {
    expect(capitalStatementParameters.safeParse({ from: 'not-a-date' }).success).toBe(false);
    expect(shareholderRegisterParameters.safeParse({ date: 'not-a-date' }).success).toBe(false);
    expect(dividendSummaryParameters.safeParse({ year: 2025.5 }).success).toBe(false);
    expect(projectInvestmentParameters.safeParse({ projectId: 123 }).success).toBe(false);
    expect(shareholdersPerProjectParameters.safeParse({}).success).toBe(false);
    expect(referralAnalyticsParameters.safeParse({ unexpected: true }).success).toBe(false);
    expect(auditLogsParameters.safeParse({ limit: 101 }).success).toBe(false);
    expect(shareholderDocumentsParameters.safeParse({ shareholderId: '' }).success).toBe(false);
    expect(generateCertificateParameters.safeParse({ shareholderId: '' }).success).toBe(false);
    expect(
      generateDividendStatementParameters.safeParse({
        shareholderId: 'shareholder-1',
      }).success,
    ).toBe(false);
  });
});
