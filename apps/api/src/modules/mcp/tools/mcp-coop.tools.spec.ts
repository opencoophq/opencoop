import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { PrismaService } from '../../../prisma/prisma.service';
import { AnalyticsService } from '../../admin/analytics.service';

jest.mock('../../coops/coops.service', () => ({
  CoopsService: class CoopsService {},
}));

import { CoopsService } from '../../coops/coops.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import { McpCoopTools, updateCoopSettingsParameters } from './mcp-coop.tools';

describe('McpCoopTools', () => {
  let tools: McpCoopTools;
  let scope: 'READ_ONLY' | 'READ_WRITE' = 'READ_WRITE';
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'k1',
    getScope: () => scope,
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
  const coops = { getSettings: jest.fn(), update: jest.fn() };

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
        { provide: CoopsService, useValue: coops },
      ],
    }).compile();
    tools = module.get(McpCoopTools);
    jest.clearAllMocks();
    scope = 'READ_WRITE';
    permissions.permissions.mockResolvedValue({
      canManageShareClasses: true,
      canManageProjects: true,
      canManageSettings: true,
    });
    billing.isReadOnly.mockResolvedValue(false);
    prisma.project.findMany.mockResolvedValue([{ id: 'p1', name: 'Solar' }]);
    analytics.getCapitalByProject.mockResolvedValue([
      { projectId: 'p1', projectName: 'Solar', totalCapital: 70, shareCount: 7, percentage: 100 },
    ]);
    coops.getSettings.mockResolvedValue({ id: 'coop-from-auth', name: 'Coop' });
    coops.update.mockResolvedValue({
      id: 'coop-from-auth',
      smtpPass: 'secret',
      graphClientSecret: 'secret',
      brevoApiKey: 'secret',
    });
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

  it('returns settings without secret fields', async () => {
    coops.getSettings.mockResolvedValue({
      id: 'coop-from-auth',
      name: 'Coop',
      smtpHost: 'smtp.example.com',
    });

    const result = await tools.getCoopSettings();

    expect(coops.getSettings).toHaveBeenCalledWith('coop-from-auth');
    expect(result).toEqual({
      id: 'coop-from-auth',
      name: 'Coop',
      smtpHost: 'smtp.example.com',
    });
    expect(result).not.toHaveProperty('smtpPass');
    expect(result).not.toHaveProperty('graphClientSecret');
    expect(result).not.toHaveProperty('brevoApiKey');
  });

  it('updates settings, then returns the select-limited settings read', async () => {
    coops.getSettings.mockResolvedValue({ id: 'coop-from-auth', name: 'Updated Coop' });

    const result = await tools.updateCoopSettings({ name: 'Updated Coop' });

    expect(coops.update).toHaveBeenCalledWith(
      'coop-from-auth',
      expect.objectContaining({ name: 'Updated Coop' }),
      'u1',
      'mcp',
      'mcp-api-key:k1',
    );
    expect(coops.getSettings).toHaveBeenCalledWith('coop-from-auth');
    expect(result).toEqual({ id: 'coop-from-auth', name: 'Updated Coop' });
    expect(result).not.toHaveProperty('smtpPass');
    expect(result).not.toHaveProperty('graphClientSecret');
    expect(result).not.toHaveProperty('brevoApiKey');
  });

  it('refuses settings writes for a read-only key and without permission', async () => {
    scope = 'READ_ONLY';
    await expect(tools.updateCoopSettings({ name: 'Nope' })).rejects.toBeInstanceOf(McpError);
    expect(coops.update).not.toHaveBeenCalled();

    scope = 'READ_WRITE';
    permissions.permissions.mockResolvedValue({});
    await expect(tools.getCoopSettings()).rejects.toBeInstanceOf(McpError);
    expect(coops.getSettings).not.toHaveBeenCalled();
  });

  it('rejects omitted secrets and admin-only switches in settings input', () => {
    expect(updateCoopSettingsParameters.safeParse({ smtpPass: 'secret' }).success).toBe(false);
    expect(updateCoopSettingsParameters.safeParse({ graphClientSecret: 'secret' }).success).toBe(
      false,
    );
    expect(updateCoopSettingsParameters.safeParse({ brevoApiKey: 'secret' }).success).toBe(false);
    expect(updateCoopSettingsParameters.safeParse({ emailEnabled: true }).success).toBe(false);
    expect(updateCoopSettingsParameters.safeParse({ pontoEnabled: true }).success).toBe(false);
    expect(updateCoopSettingsParameters.safeParse({ minimumHoldingPeriod: -1 }).success).toBe(
      false,
    );
  });
});
