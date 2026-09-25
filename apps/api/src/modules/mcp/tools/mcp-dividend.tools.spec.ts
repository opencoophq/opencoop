import { Test } from '@nestjs/testing';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { DividendsService } from '../../dividends/dividends.service';
import { CreateDividendPeriodDto } from '../../dividends/dto/create-dividend-period.dto';
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
    getExportRows: jest.fn(),
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
    dividendsService.getExportRows.mockResolvedValue([
      {
        id: 'shareholder-1234',
        type: 'INDIVIDUAL',
        firstName: 'Ada',
        lastName: 'Lovelace',
        companyName: null,
        email: 'ada@example.com',
        emailSource: 'shareholder',
        grossAmount: 100,
        withholdingTax: 30,
        netAmount: 70,
        reference: 'Dividend 2026 - Open Coop',
      },
    ]);
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
    expect(dividendsService.getExportRows).toHaveBeenCalledWith('period-1', 'coop-from-auth');
    expect(exported).toEqual([
      {
        id: 'shareholder-1234',
        type: 'INDIVIDUAL',
        firstName: 'Ada',
        lastName: 'Lovelace',
        companyName: null,
        email: 'ada@example.com',
        emailSource: 'shareholder',
        grossAmount: 100,
        withholdingTax: 30,
        netAmount: 70,
        reference: 'Dividend 2026 - Open Coop',
      },
    ]);
  });

  it('rejects without canManageDividends', async () => {
    permissions.permissions.mockResolvedValue({});

    await expect(tools.listDividendPeriods({})).rejects.toBeInstanceOf(McpError);
    expect(dividendsService.findAll).not.toHaveBeenCalled();
  });

  it('rejects invalid DTO input before calling the dividend service', async () => {
    await expect(tools.createDividendPeriod({ ...createParams, name: '' })).rejects.toMatchObject({
      message: expect.stringContaining('name must be longer than or equal to 1 characters'),
    });
    expect(dividendsService.create).not.toHaveBeenCalled();
  });

  it('passes a validated DTO instance to the dividend service', async () => {
    await tools.createDividendPeriod(createParams);

    const dto = dividendsService.create.mock.calls[0][1];
    expect(dto).toBeInstanceOf(CreateDividendPeriodDto);
    expect(dto).toEqual(createParams);
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

  it('returns and masks structured export rows when a company name contains a semicolon', async () => {
    permissions.permissions.mockResolvedValue({ canManageDividends: true, canViewPII: false });
    dividendsService.getExportRows.mockResolvedValue([
      {
        id: 'shareholder-1234',
        type: 'COMPANY',
        firstName: null,
        lastName: null,
        companyName: 'Coop; Labs',
        email: 'finance@coop-labs.example',
        emailSource: 'shareholder',
        grossAmount: 100,
        withholdingTax: 30,
        netAmount: 70,
        reference: 'Dividend 2026 - Open Coop',
      },
    ]);

    const result = await tools.exportDividends({ dividendPeriodId: 'period-1' });

    expect(result).toEqual([
      {
        id: 'shareholder-1234',
        type: 'COMPANY',
        firstName: 'Aandeelhouder #1234',
        lastName: '',
        companyName: 'Aandeelhouder #1234',
        email: '***',
        emailSource: 'shareholder',
        grossAmount: 100,
        withholdingTax: 30,
        netAmount: 70,
        reference: 'Dividend 2026 - Open Coop',
        phone: null,
        address: null,
        city: null,
        postalCode: null,
        companyId: null,
        name: 'Aandeelhouder #1234',
      },
    ]);
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
