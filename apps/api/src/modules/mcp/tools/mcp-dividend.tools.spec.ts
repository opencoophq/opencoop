import { Test } from '@nestjs/testing';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { DividendsService } from '../../dividends/dividends.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import {
  createDividendPeriodParameters,
  getDividendPeriodParameters,
  McpDividendTools,
} from './mcp-dividend.tools';

describe('McpDividendTools', () => {
  let tools: McpDividendTools;
  let scope: 'READ_ONLY' | 'READ_WRITE' = 'READ_WRITE';
  const auth = {
    getUserId: () => 'user-from-auth',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'key-1',
    getScope: () => scope,
  };
  const permissions = { permissions: jest.fn(), permissionsWithRole: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const dividendsService = {
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    calculate: jest.fn(),
    markAsPaid: jest.fn(),
    exportToCsv: jest.fn(),
  };
  const createParams = {
    name: '2026 Annual Dividend',
    year: 2026,
    dividendRate: 2.5,
    withholdingTaxRate: 30,
    exDividendDate: '2026-12-31',
    paymentDate: '2027-01-15',
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpDividendTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: DividendsService, useValue: dividendsService },
      ],
    }).compile();
    tools = module.get(McpDividendTools);
    jest.clearAllMocks();
    permissions.permissionsWithRole.mockImplementation(async () => ({
      permissions: await permissions.permissions(),
      role: 'COOP_ADMIN',
    }));
    scope = 'READ_WRITE';
    permissions.permissions.mockResolvedValue({ canManageDividends: true });
    billing.isReadOnly.mockResolvedValue(false);
    dividendsService.findAll.mockResolvedValue([{ id: 'period-1' }]);
    dividendsService.findById.mockResolvedValue({ id: 'period-1', payouts: [] });
    dividendsService.create.mockResolvedValue({ id: 'period-2' });
    dividendsService.calculate.mockResolvedValue({ id: 'period-1', status: 'CALCULATED' });
    dividendsService.markAsPaid.mockResolvedValue({ id: 'period-1', status: 'PAID' });
    dividendsService.exportToCsv.mockResolvedValue('name;amount\nAda;10');
  });

  it('passes the authenticated coop and audit context to every dividend service operation', async () => {
    await tools.listDividendPeriods({});
    await tools.getDividendPeriod({ dividendPeriodId: 'period-1' });
    await tools.createDividendPeriod(createParams);
    await tools.calculateDividends({ dividendPeriodId: 'period-1' });
    await tools.markDividendsPaid({
      dividendPeriodId: 'period-1',
      paymentReference: 'PAY-2026-01',
    });
    const exported = await tools.exportDividends({ dividendPeriodId: 'period-1' });

    expect(dividendsService.findAll).toHaveBeenCalledWith('coop-from-auth');
    expect(dividendsService.findById).toHaveBeenCalledWith('period-1', 'coop-from-auth');
    expect(dividendsService.create).toHaveBeenCalledWith(
      'coop-from-auth',
      createParams,
      'user-from-auth',
      'mcp',
      'mcp-api-key:key-1',
    );
    expect(dividendsService.calculate).toHaveBeenCalledWith(
      'period-1',
      'coop-from-auth',
      'user-from-auth',
      'mcp',
      'mcp-api-key:key-1',
    );
    expect(dividendsService.markAsPaid).toHaveBeenCalledWith(
      'period-1',
      'coop-from-auth',
      'PAY-2026-01',
      'user-from-auth',
      'mcp',
      'mcp-api-key:key-1',
    );
    expect(dividendsService.exportToCsv).toHaveBeenCalledWith('period-1', 'coop-from-auth');
    expect(exported).toEqual({ result: 'name;amount\nAda;10' });
  });

  it('rejects without canManageDividends', async () => {
    permissions.permissions.mockResolvedValue({});

    await expect(tools.listDividendPeriods({})).rejects.toBeInstanceOf(McpError);
    expect(dividendsService.findAll).not.toHaveBeenCalled();
  });

  it('masks shareholder PII nested in a dividend period', async () => {
    permissions.permissions.mockResolvedValue({ canManageDividends: true, canViewPII: false });
    dividendsService.findById.mockResolvedValue({
      id: 'period-1',
      payouts: [
        {
          id: 'payout-1',
          shareholder: {
            id: 'shareholder-1234',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
          },
        },
      ],
    });

    const result = await tools.getDividendPeriod({ dividendPeriodId: 'period-1' });

    expect(result).toEqual({
      id: 'period-1',
      payouts: [
        {
          id: 'payout-1',
          shareholder: expect.objectContaining({
            firstName: 'Aandeelhouder #1234',
            lastName: '',
            email: '***',
          }),
        },
      ],
    });
  });

  it('masks shareholder PII in dividend CSV exports', async () => {
    permissions.permissions.mockResolvedValue({ canManageDividends: true, canViewPII: false });
    dividendsService.exportToCsv.mockResolvedValue(
      'Shareholder ID;Name;Type;Email\nshareholder-1234;"Ada Lovelace";INDIVIDUAL;ada@example.com',
    );

    const result = await tools.exportDividends({ dividendPeriodId: 'period-1' });

    expect(result).toEqual({
      result: 'Shareholder ID;Name;Type;Email\nshareholder-1234;"Aandeelhouder #1";INDIVIDUAL;***',
    });
  });

  it('rejects write tools for a READ_ONLY key', async () => {
    scope = 'READ_ONLY';

    await expect(tools.calculateDividends({ dividendPeriodId: 'period-1' })).rejects.toBeInstanceOf(
      McpError,
    );
    expect(dividendsService.calculate).not.toHaveBeenCalled();
  });

  it('validates dividend input and rejects a coopId field', () => {
    expect(
      createDividendPeriodParameters.safeParse({
        ...createParams,
        year: 1999,
      }).success,
    ).toBe(false);
    expect(
      createDividendPeriodParameters.safeParse({
        ...createParams,
        exDividendDate: 'not-a-date',
      }).success,
    ).toBe(false);
    expect(
      getDividendPeriodParameters.safeParse({ dividendPeriodId: 'period-1', coopId: 'other' })
        .success,
    ).toBe(false);
  });
});
