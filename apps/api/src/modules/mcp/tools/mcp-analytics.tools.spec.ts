import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
jest.mock('../../admin/reports.service', () => ({
  ReportsService: class ReportsService {},
}));
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { PrismaService } from '../../../prisma/prisma.service';
import { AnalyticsService } from '../../admin/analytics.service';
import { ReportsService } from '../../admin/reports.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import {
  annualOverviewParameters,
  capitalTimelineParameters,
  McpAnalyticsTools,
} from './mcp-analytics.tools';

describe('McpAnalyticsTools', () => {
  let tools: McpAnalyticsTools;
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'k1',
    getScope: () => 'READ_WRITE' as const,
  };
  const permissions = { permissions: jest.fn(), permissionsWithRole: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const prisma = {
    registration: { findFirst: jest.fn() },
    payment: { findFirst: jest.fn() },
  };
  const analytics = {
    getCapitalTimeline: jest.fn(),
    getCapitalByProject: jest.fn(),
    getShareholderGrowth: jest.fn(),
    getTransactionSummary: jest.fn(),
  };
  const reports = { getAnnualOverview: jest.fn() };
  const earliest = new Date('2020-01-02T00:00:00.000Z');
  const earliestPaymentBankDate = new Date('1999-01-02T00:00:00.000Z');
  const earliestBuyRegisterDate = new Date('2001-05-06T00:00:00.000Z');

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpAnalyticsTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: PrismaService, useValue: prisma },
        { provide: AnalyticsService, useValue: analytics },
        { provide: ReportsService, useValue: reports },
      ],
    }).compile();
    tools = module.get(McpAnalyticsTools);
    jest.resetAllMocks();
    permissions.permissionsWithRole.mockImplementation(async () => ({
      permissions: await permissions.permissions(),
      role: 'COOP_ADMIN',
    }));
    permissions.permissions.mockResolvedValue({ canViewReports: true });
    billing.isReadOnly.mockResolvedValue(false);
    prisma.registration.findFirst.mockResolvedValue({
      registerDate: earliest,
      createdAt: earliest,
    });
    prisma.payment.findFirst.mockResolvedValue({ bankDate: earliestPaymentBankDate });
    analytics.getCapitalTimeline.mockResolvedValue([
      {
        date: '2020-01-01T00:00:00.000Z',
        totalCapital: new Decimal('10.50'),
        netChange: new Decimal('2.25'),
      },
    ]);
    analytics.getCapitalByProject.mockResolvedValue([
      { projectId: 'p1', projectName: 'Solar', totalCapital: 10, shareCount: 1, percentage: 100 },
    ]);
    analytics.getShareholderGrowth.mockResolvedValue([]);
    analytics.getTransactionSummary.mockResolvedValue({
      timeline: [],
      totals: { buys: 0, sells: 0, volume: 0 },
    });
    reports.getAnnualOverview.mockResolvedValue({ year: 2025, capitalEnd: new Decimal('99.99') });
  });

  it('uses the earliest relevant payment bankDate and BUY registerDate for defaults', async () => {
    prisma.payment.findFirst.mockResolvedValue({ bankDate: earliestPaymentBankDate });
    prisma.registration.findFirst
      .mockResolvedValueOnce({ registerDate: earliestBuyRegisterDate })
      .mockResolvedValueOnce({ createdAt: earliest });

    await tools.getCapitalTimeline({});
    await tools.getShareholderGrowth({});

    expect(analytics.getCapitalTimeline).toHaveBeenCalledWith(
      'coop-from-auth',
      'month',
      earliestPaymentBankDate.toISOString(),
      undefined,
    );
    expect(analytics.getShareholderGrowth).toHaveBeenCalledWith(
      'coop-from-auth',
      'month',
      earliestBuyRegisterDate.toISOString(),
      undefined,
    );
  });

  it('rejects a report when canViewReports is absent', async () => {
    permissions.permissions.mockResolvedValue({});

    await expect(tools.getAnnualOverview({ year: 2025 })).rejects.toBeInstanceOf(McpError);
    expect(reports.getAnnualOverview).not.toHaveBeenCalled();
  });

  it('uses the authenticated coop and earliest registration for full-history analytics', async () => {
    await tools.getCapitalTimeline({ bucket: 'year' });
    await tools.getShareholderGrowth({ bucket: 'quarter' });
    await tools.getTransactionSummary({ bucket: 'day' });
    await tools.getCapitalByProject({});

    expect(prisma.payment.findFirst).toHaveBeenCalledWith({
      where: {
        registration: {
          coopId: 'coop-from-auth',
          status: { in: ['ACTIVE', 'COMPLETED'] },
        },
      },
      orderBy: { bankDate: 'asc' },
      select: { bankDate: true },
    });
    expect(prisma.registration.findFirst).toHaveBeenCalledWith({
      where: {
        coopId: 'coop-from-auth',
        type: 'BUY',
        status: { in: ['ACTIVE', 'COMPLETED'] },
      },
      orderBy: { registerDate: 'asc' },
      select: { registerDate: true },
    });
    expect(prisma.registration.findFirst).toHaveBeenCalledWith({
      where: { coopId: 'coop-from-auth' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    expect(analytics.getCapitalTimeline).toHaveBeenCalledWith(
      'coop-from-auth',
      'year',
      earliestPaymentBankDate.toISOString(),
      undefined,
    );
    expect(analytics.getShareholderGrowth).toHaveBeenCalledWith(
      'coop-from-auth',
      'quarter',
      earliest.toISOString(),
      undefined,
    );
    expect(analytics.getTransactionSummary).toHaveBeenCalledWith(
      'coop-from-auth',
      'day',
      earliest.toISOString(),
      undefined,
    );
    expect(analytics.getCapitalByProject).toHaveBeenCalledWith(
      'coop-from-auth',
      undefined,
      undefined,
    );
  });

  it('passes an explicit date without replacing it with the earliest date', async () => {
    await tools.getCapitalTimeline({ from: '2024-01-01', to: '2024-12-31' });

    expect(prisma.registration.findFirst).not.toHaveBeenCalled();
    expect(analytics.getCapitalTimeline).toHaveBeenCalledWith(
      'coop-from-auth',
      'month',
      '2024-01-01',
      '2024-12-31',
    );
  });

  it('normalises Decimal report fields to numbers', async () => {
    const result = await tools.getAnnualOverview({ year: 2025 });

    expect(result).toEqual({ year: 2025, capitalEnd: 99.99 });
  });

  it('rejects invalid bucket and year values', () => {
    expect(capitalTimelineParameters.safeParse({ bucket: 'week' }).success).toBe(false);
    expect(annualOverviewParameters.safeParse({ year: 1899 }).success).toBe(false);
    expect(annualOverviewParameters.safeParse({ year: 2201 }).success).toBe(false);
  });
});
