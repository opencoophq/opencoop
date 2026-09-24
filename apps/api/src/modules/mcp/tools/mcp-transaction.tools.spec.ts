import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
jest.mock('../../registrations/registrations.service', () => ({
  RegistrationsService: class RegistrationsService {},
}));
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { RegistrationsService } from '../../registrations/registrations.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import { McpTransactionTools, listRegistrationsParameters } from './mcp-transaction.tools';

describe('McpTransactionTools', () => {
  let tools: McpTransactionTools;
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'k1',
    getScope: () => 'READ_WRITE' as const,
  };
  const permissions = { permissions: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const registrations = { findAll: jest.fn(), findById: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpTransactionTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: RegistrationsService, useValue: registrations },
      ],
    }).compile();
    tools = module.get(McpTransactionTools);
    jest.clearAllMocks();
    permissions.permissions.mockResolvedValue({
      canManageTransactions: true,
      canViewPII: false,
    });
    billing.isReadOnly.mockResolvedValue(false);
    registrations.findAll.mockResolvedValue({
      items: [{ id: 'r1', totalAmount: new Decimal('25.50') }],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    registrations.findById.mockResolvedValue({
      id: 'r1',
      type: 'BUY',
      totalAmount: new Decimal('25.50'),
      ogmCode: '+++123/4567/89012+++',
      shareholder: {
        id: 'shareholder-5678',
        type: 'INDIVIDUAL',
        firstName: 'Grace',
        lastName: 'Hopper',
        companyName: null,
        email: 'grace@example.com',
        nationalId: 'secret',
        address: { city: 'Brussels' },
      },
      payments: [{ amount: new Decimal('25.50') }],
    });
  });

  it('rejects without canManageTransactions', async () => {
    permissions.permissions.mockResolvedValue({});

    await expect(tools.listRegistrations({})).rejects.toBeInstanceOf(McpError);
    expect(registrations.findAll).not.toHaveBeenCalled();
  });

  it('uses the authenticated coop and never a coop from tool input', async () => {
    await tools.listRegistrations({ shareholderId: 's1' });
    await tools.getRegistration({ registrationId: 'r1' });

    expect(registrations.findAll).toHaveBeenCalledWith('coop-from-auth', {
      status: undefined,
      type: undefined,
      shareholderId: 's1',
      channelId: undefined,
      fromDate: undefined,
      toDate: undefined,
      page: undefined,
      pageSize: 25,
    });
    expect(registrations.findById).toHaveBeenCalledWith('r1', 'coop-from-auth');
  });

  it('returns numbers, a shareholder summary, and a masked summary when PII is hidden', async () => {
    const result = await tools.getRegistration({ registrationId: 'r1' });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'r1',
        totalAmount: 25.5,
        ogmCode: '+++123/4567/89012+++',
        shareholder: expect.objectContaining({
          id: 'shareholder-5678',
          firstName: 'Aandeelhouder #5678',
          lastName: '',
          email: '***',
        }),
      }),
    );
    expect(result).not.toHaveProperty('shareholder.nationalId');
    expect(result).toHaveProperty('shareholder.address', null);
  });

  it('returns the summary PII when canViewPII is true', async () => {
    permissions.permissions.mockResolvedValue({
      canManageTransactions: true,
      canViewPII: true,
    });

    const result = await tools.getRegistration({ registrationId: 'r1' });

    expect(result).toEqual(
      expect.objectContaining({
        shareholder: {
          id: 'shareholder-5678',
          type: 'INDIVIDUAL',
          firstName: 'Grace',
          lastName: 'Hopper',
          companyName: null,
          email: 'grace@example.com',
        },
      }),
    );
  });

  it('rejects invalid enum and date values', () => {
    expect(listRegistrationsParameters.safeParse({ status: 'UNKNOWN' }).success).toBe(false);
    expect(listRegistrationsParameters.safeParse({ type: 'UNKNOWN' }).success).toBe(false);
    expect(listRegistrationsParameters.safeParse({ fromDate: 'not-a-date' }).success).toBe(false);
  });
});
