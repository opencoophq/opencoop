import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { HouseholdService } from '../../shareholders/household.service';
import { ShareholdersService } from '../../shareholders/shareholders.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import {
  McpShareholderTools,
  createShareholderParameters,
  listShareholdersParameters,
  updateShareholderParameters,
} from './mcp-shareholder.tools';

describe('McpShareholderTools', () => {
  let tools: McpShareholderTools;
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'k1',
    getScope: jest.fn(),
  };
  const permissions = { permissions: jest.fn(), permissionsWithRole: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const shareholders = {
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMinorsByShareholderId: jest.fn(),
  };
  const household = {
    searchHouseholdCandidates: jest.fn(),
    linkShareholders: jest.fn(),
    unlinkShareholder: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpShareholderTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: ShareholdersService, useValue: shareholders },
        { provide: HouseholdService, useValue: household },
      ],
    }).compile();
    tools = module.get(McpShareholderTools);
    jest.clearAllMocks();
    permissions.permissionsWithRole.mockImplementation(async () => ({
      permissions: await permissions.permissions(),
      role: 'COOP_ADMIN',
    }));
    auth.getScope.mockReturnValue('READ_WRITE');
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
    shareholders.create.mockResolvedValue({ id: 'created-shareholder' });
    shareholders.update.mockResolvedValue({ id: 'shareholder-1234', email: null });
    shareholders.findMinorsByShareholderId.mockResolvedValue([
      {
        id: 'minor-1234',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada.minor@example.com',
      },
    ]);
    household.searchHouseholdCandidates.mockResolvedValue([
      {
        shareholderId: 'target-1234',
        email: 'target@example.com',
        fullName: 'Target Shareholder',
        shareholderCount: 2,
      },
    ]);
    household.linkShareholders.mockResolvedValue({ id: 'shareholder-1234' });
    household.unlinkShareholder.mockResolvedValue({ id: 'emancipation-1234' });
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
    expect(list).toHaveProperty('items.0.nationalId', '***');
    expect(detail).toEqual(
      expect.objectContaining({
        firstName: 'Aandeelhouder #1234',
        lastName: '',
        email: '***',
        registrations: [{ pricePerShare: 10.25 }],
      }),
    );
    expect(detail).toHaveProperty('nationalId', '***');
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

  it('creates and updates shareholders with the authenticated coop and audit context', async () => {
    await tools.createShareholder({ type: 'INDIVIDUAL', email: 'new@example.com' });
    await tools.updateShareholder({ shareholderId: 'shareholder-1234', email: null });

    expect(shareholders.create).toHaveBeenCalledWith(
      'coop-from-auth',
      expect.objectContaining({ type: 'INDIVIDUAL', email: 'new@example.com' }),
      'u1',
      'mcp',
      'mcp-api-key:k1',
    );
    expect(shareholders.update).toHaveBeenCalledWith(
      'shareholder-1234',
      'coop-from-auth',
      expect.objectContaining({ email: null }),
      'u1',
      'mcp',
      'mcp-api-key:k1',
    );
    expect(shareholders.update.mock.calls[0][2]).not.toHaveProperty('shareholderId');
  });

  it('masks created shareholder PII when canViewPII is false', async () => {
    shareholders.create.mockResolvedValue({
      id: 'created-1234',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+3212345678',
    });

    const result = await tools.createShareholder({ type: 'INDIVIDUAL', email: 'new@example.com' });

    expect(result).toEqual(
      expect.objectContaining({
        firstName: 'Aandeelhouder #1234',
        lastName: '',
        email: '***',
        phone: '***',
      }),
    );
  });

  it('masks updated shareholder PII when canViewPII is false', async () => {
    shareholders.update.mockResolvedValue({
      id: 'shareholder-1234',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });

    const result = await tools.updateShareholder({
      shareholderId: 'shareholder-1234',
      email: 'new@example.com',
    });

    expect(result).toEqual(
      expect.objectContaining({
        firstName: 'Aandeelhouder #1234',
        lastName: '',
        email: '***',
      }),
    );
  });

  it('gets minors through the extracted service method and masks the list', async () => {
    const result = await tools.getShareholderMinors({ shareholderId: 'shareholder-1234' });

    expect(shareholders.findMinorsByShareholderId).toHaveBeenCalledWith(
      'shareholder-1234',
      'coop-from-auth',
    );
    expect(result).toEqual([
      expect.objectContaining({ firstName: 'Aandeelhouder #1234', email: '***' }),
    ]);
  });

  it('uses shareholder IDs and the authenticated coop for household tools', async () => {
    await tools.searchHouseholdUsers({ shareholderId: 'shareholder-1234', search: 'target' });
    await tools.linkHousehold({
      shareholderId: 'shareholder-1234',
      targetShareholderId: 'target-1234',
    });
    await tools.emancipateShareholder({ shareholderId: 'shareholder-1234' });

    expect(household.searchHouseholdCandidates).toHaveBeenCalledWith(
      'coop-from-auth',
      'shareholder-1234',
      'target',
    );
    expect(household.linkShareholders).toHaveBeenCalledWith({
      coopId: 'coop-from-auth',
      shareholderId: 'shareholder-1234',
      targetShareholderId: 'target-1234',
      actorUserId: 'u1',
    });
    expect(household.unlinkShareholder).toHaveBeenCalledWith({
      coopId: 'coop-from-auth',
      shareholderId: 'shareholder-1234',
      actorUserId: 'u1',
    });
  });

  it('masks household candidate PII when canViewPII is false', async () => {
    const result = await tools.searchHouseholdUsers({
      shareholderId: 'shareholder-1234',
      search: '',
    });

    expect(result).toEqual([
      {
        shareholderId: 'target-1234',
        email: '***',
        fullName: 'Aandeelhouder #1234',
        shareholderCount: 2,
      },
    ]);
  });

  it('masks the updated shareholder returned by link_household when canViewPII is false', async () => {
    household.linkShareholders.mockResolvedValue({
      id: 'shareholder-1234',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });

    const result = await tools.linkHousehold({
      shareholderId: 'shareholder-1234',
      targetShareholderId: 'target-1234',
    });

    expect(result).toEqual(
      expect.objectContaining({
        firstName: 'Aandeelhouder #1234',
        lastName: '',
        email: '***',
      }),
    );
  });

  it('rejects writes through a read-only API key', async () => {
    auth.getScope.mockReturnValue('READ_ONLY');

    await expect(
      tools.createShareholder({ type: 'INDIVIDUAL', email: 'new@example.com' }),
    ).rejects.toBeInstanceOf(McpError);
    expect(shareholders.create).not.toHaveBeenCalled();
  });

  it('rejects invalid shareholder status and type enum values', () => {
    expect(listShareholdersParameters.safeParse({ status: 'UNKNOWN' }).success).toBe(false);
    expect(listShareholdersParameters.safeParse({ type: 'UNKNOWN' }).success).toBe(false);
    expect(createShareholderParameters.safeParse({ type: 'INDIVIDUAL' }).success).toBe(false);
    expect(
      updateShareholderParameters.safeParse({ shareholderId: 'shareholder-1234', email: null })
        .success,
    ).toBe(true);
    expect(
      updateShareholderParameters.safeParse({ shareholderId: 'shareholder-1234', unexpected: true })
        .success,
    ).toBe(false);
  });
});
