import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { ShareholdersService } from '../../shareholders/shareholders.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import { McpShareholderTools, listShareholdersParameters } from './mcp-shareholder.tools';

describe('McpShareholderTools', () => {
  let tools: McpShareholderTools;
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'k1',
    getScope: () => 'READ_WRITE' as const,
  };
  const permissions = { permissions: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const shareholders = { findAll: jest.fn(), findById: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpShareholderTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: ShareholdersService, useValue: shareholders },
      ],
    }).compile();
    tools = module.get(McpShareholderTools);
    jest.clearAllMocks();
    permissions.permissions.mockResolvedValue({
      canManageShareholders: true,
      canViewPII: false,
    });
    billing.isReadOnly.mockResolvedValue(false);
    shareholders.findAll.mockResolvedValue({
      items: [
        {
          id: 'shareholder-1234',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          nationalId: 'secret',
          sharesOwned: new Decimal('12.5'),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    shareholders.findById.mockResolvedValue({
      id: 'shareholder-1234',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+3212345678',
      nationalId: 'secret',
      registrations: [{ pricePerShare: new Decimal('10.25') }],
    });
  });

  it('rejects without canManageShareholders', async () => {
    permissions.permissions.mockResolvedValue({});

    await expect(tools.listShareholders({})).rejects.toBeInstanceOf(McpError);
    expect(shareholders.findAll).not.toHaveBeenCalled();
  });

  it('uses the authenticated coop for both shareholder service calls', async () => {
    await tools.listShareholders({ search: 'Ada' });
    await tools.getShareholder({ shareholderId: 'shareholder-1234' });

    expect(shareholders.findAll).toHaveBeenCalledWith('coop-from-auth', {
      search: 'Ada',
      status: undefined,
      type: undefined,
      channelId: undefined,
      page: undefined,
      pageSize: 25,
    });
    expect(shareholders.findById).toHaveBeenCalledWith('shareholder-1234', 'coop-from-auth');
  });

  it('masks list and detail PII while preserving the shape and normalising decimals', async () => {
    const list = await tools.listShareholders({});
    const detail = await tools.getShareholder({ shareholderId: 'shareholder-1234' });

    expect(list).toEqual({
      items: [
        expect.objectContaining({
          firstName: 'Aandeelhouder #1234',
          lastName: '',
          email: '***',
          sharesOwned: 12.5,
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    expect(list).not.toHaveProperty('items.0.nationalId');
    expect(detail).toEqual(
      expect.objectContaining({
        firstName: 'Aandeelhouder #1234',
        lastName: '',
        email: '***',
        registrations: [{ pricePerShare: 10.25 }],
      }),
    );
    expect(detail).not.toHaveProperty('nationalId');
  });

  it('leaves visible PII unmasked when canViewPII is true', async () => {
    permissions.permissions.mockResolvedValue({
      canManageShareholders: true,
      canViewPII: true,
    });

    const result = await tools.getShareholder({ shareholderId: 'shareholder-1234' });

    expect(result).toEqual(
      expect.objectContaining({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        registrations: [{ pricePerShare: 10.25 }],
      }),
    );
  });

  it('rejects invalid shareholder status and type enum values', () => {
    expect(listShareholdersParameters.safeParse({ status: 'UNKNOWN' }).success).toBe(false);
    expect(listShareholdersParameters.safeParse({ type: 'UNKNOWN' }).success).toBe(false);
  });
});
