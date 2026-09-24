import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { PrismaService } from '../../../prisma/prisma.service';
import { AnalyticsService } from '../../admin/analytics.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import { McpCoopTools } from './mcp-coop.tools';

describe('McpCoopTools', () => {
  let tools: McpCoopTools;
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'k1',
    getScope: () => 'READ_WRITE' as const,
  };
  const permissions = { permissions: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const prisma = {
    coop: { findUniqueOrThrow: jest.fn() },
    shareClass: { findMany: jest.fn() },
    project: { findMany: jest.fn() },
    shareholder: { count: jest.fn() },
    registration: { count: jest.fn() },
    bankTransaction: { count: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const analytics = { getCapitalByProject: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpCoopTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: PrismaService, useValue: prisma },
        { provide: AnalyticsService, useValue: analytics },
      ],
    }).compile();
    tools = module.get(McpCoopTools);
    jest.clearAllMocks();
    permissions.permissions.mockResolvedValue({
      canManageShareClasses: true,
      canManageProjects: true,
    });
    billing.isReadOnly.mockResolvedValue(false);
    prisma.project.findMany.mockResolvedValue([{ id: 'p1', name: 'Solar' }]);
    analytics.getCapitalByProject.mockResolvedValue([
      { projectId: 'p1', projectName: 'Solar', totalCapital: 70, shareCount: 7, percentage: 100 },
    ]);
  });

  it('rejects a protected tool when the matching permission is absent', async () => {
    permissions.permissions.mockResolvedValue({});

    await expect(tools.listShareClasses()).rejects.toBeInstanceOf(McpError);
    expect(prisma.shareClass.findMany).not.toHaveBeenCalled();
  });

  it('uses the authenticated coop for coop and project queries', async () => {
    prisma.coop.findUniqueOrThrow.mockResolvedValue({ id: 'coop-from-auth', name: 'Coop' });
    await tools.getCoopInfo();
    await tools.listProjects();

    expect(prisma.coop.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'coop-from-auth' } }),
    );
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { coopId: 'coop-from-auth' },
      orderBy: { name: 'asc' },
    });
    expect(analytics.getCapitalByProject).toHaveBeenCalledWith('coop-from-auth');
  });

  it('normalises Decimal share-class fields to numbers', async () => {
    prisma.shareClass.findMany.mockResolvedValue([
      { id: 'sc1', pricePerShare: new Decimal('12.50') },
    ]);

    const result = await tools.listShareClasses();

    expect(result).toEqual([{ id: 'sc1', pricePerShare: 12.5 }]);
  });

  it('uses net share counts from analytics so sells reduce sharesSold', async () => {
    const result = await tools.listProjects();

    expect(result).toEqual([{ id: 'p1', name: 'Solar', sharesSold: 7 }]);
  });
});
