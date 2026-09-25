import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
jest.mock('../../registrations/registrations.service', () => ({
  RegistrationsService: class RegistrationsService {},
}));
jest.mock('../../payments/payments.service', () => ({
  PaymentsService: class PaymentsService {},
}));
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { PaymentsService } from '../../payments/payments.service';
import { RegistrationsService } from '../../registrations/registrations.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import {
  McpTransactionTools,
  addPaymentParameters,
  approveRegistrationParameters,
  buySharesForShareholderParameters,
  cancelRegistrationParameters,
  completeRegistrationParameters,
  createTransferParameters,
  getPaymentDetailsParameters,
  listRegistrationsParameters,
  rejectRegistrationParameters,
  resendPaymentEmailParameters,
  sellSharesForShareholderParameters,
  setPaymentDateParameters,
} from './mcp-transaction.tools';

describe('McpTransactionTools', () => {
  let tools: McpTransactionTools;
  let keyScope: 'READ_ONLY' | 'READ_WRITE' = 'READ_WRITE';
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'k1',
    getScope: () => keyScope,
  };
  const permissions = { permissions: jest.fn(), permissionsWithRole: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const registrations = {
    findAll: jest.fn(),
    findById: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    cancel: jest.fn(),
    createTransfer: jest.fn(),
    createBuy: jest.fn(),
    createSell: jest.fn(),
    getPaymentDetails: jest.fn(),
    complete: jest.fn(),
    updatePaymentDate: jest.fn(),
    resendPaymentEmail: jest.fn(),
  };
  const payments = { addPayment: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpTransactionTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: RegistrationsService, useValue: registrations },
        { provide: PaymentsService, useValue: payments },
      ],
    }).compile();
    tools = module.get(McpTransactionTools);
    jest.clearAllMocks();
    permissions.permissionsWithRole.mockImplementation(async () => ({
      permissions: await permissions.permissions(),
      role: 'COOP_ADMIN',
    }));
    keyScope = 'READ_WRITE';
    permissions.permissions.mockResolvedValue({
      canManageTransactions: true,
      canManageShareholders: true,
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

  it('rejects write tools for read-only keys and missing permissions', async () => {
    keyScope = 'READ_ONLY';

    await expect(tools.approveRegistration({ registrationId: 'r1' })).rejects.toBeInstanceOf(
      McpError,
    );
    expect(registrations.approve).not.toHaveBeenCalled();

    keyScope = 'READ_WRITE';
    permissions.permissions.mockResolvedValue({});

    await expect(tools.approveRegistration({ registrationId: 'r1' })).rejects.toBeInstanceOf(
      McpError,
    );
    expect(registrations.approve).not.toHaveBeenCalled();
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

  it('masks payment beneficiary and bank details when PII is hidden', async () => {
    registrations.getPaymentDetails.mockResolvedValue({
      beneficiaryName: 'Ada Lovelace',
      iban: 'BE123',
      bic: 'BIC123',
      amount: 25.5,
    });

    await expect(tools.getPaymentDetails({ registrationId: 'r1' })).resolves.toEqual({
      beneficiaryName: '***',
      iban: '***',
      bic: '***',
      amount: 25.5,
    });
  });

  it('rejects invalid enum and date values', () => {
    expect(listRegistrationsParameters.safeParse({ status: 'UNKNOWN' }).success).toBe(false);
    expect(listRegistrationsParameters.safeParse({ type: 'UNKNOWN' }).success).toBe(false);
    expect(listRegistrationsParameters.safeParse({ fromDate: 'not-a-date' }).success).toBe(false);
  });

  it('validates the new tool parameter schemas', () => {
    expect(approveRegistrationParameters.safeParse({ registrationId: 123 }).success).toBe(false);
    expect(rejectRegistrationParameters.safeParse({ registrationId: 'r1' }).success).toBe(false);
    expect(cancelRegistrationParameters.safeParse({ reason: 123 }).success).toBe(false);
    expect(
      createTransferParameters.safeParse({
        fromShareholderId: 's1',
        toShareholderId: 's2',
        registrationId: 'r1',
        quantity: 0,
      }).success,
    ).toBe(false);
    expect(
      buySharesForShareholderParameters.safeParse({
        shareholderId: 's1',
        shareClassId: 'sc1',
        quantity: 1.5,
      }).success,
    ).toBe(false);
    expect(
      sellSharesForShareholderParameters.safeParse({
        shareholderId: 's1',
        registrationId: 'r1',
        quantity: 0,
      }).success,
    ).toBe(false);
    expect(getPaymentDetailsParameters.safeParse({ registrationId: 123 }).success).toBe(false);
    expect(
      completeRegistrationParameters.safeParse({
        registrationId: 'r1',
        bankDate: 'not-a-date',
      }).success,
    ).toBe(false);
    expect(
      setPaymentDateParameters.safeParse({
        registrationId: 'r1',
        bankDate: 'not-a-date',
      }).success,
    ).toBe(false);
    expect(
      addPaymentParameters.safeParse({
        registrationId: 'r1',
        amount: 0,
        bankDate: '2026-01-01',
      }).success,
    ).toBe(false);
    expect(resendPaymentEmailParameters.safeParse({ registrationId: 123 }).success).toBe(false);
  });

  it('uses the authenticated coop and user for every new tool', async () => {
    await tools.approveRegistration({ registrationId: 'r1' });
    await tools.rejectRegistration({ registrationId: 'r1', reason: 'Not eligible' });
    await tools.cancelRegistration({ registrationId: 'r1', reason: 'Duplicate' });
    await tools.createTransfer({
      fromShareholderId: 's1',
      toShareholderId: 's2',
      registrationId: 'r1',
      quantity: 2,
    });
    await tools.buySharesForShareholder({
      shareholderId: 's1',
      shareClassId: 'sc1',
      quantity: 3,
      projectId: 'p1',
      isSavings: true,
    });
    await tools.sellSharesForShareholder({
      shareholderId: 's1',
      registrationId: 'r1',
      quantity: 1,
    });
    await tools.getPaymentDetails({ registrationId: 'r1' });
    await tools.completeRegistration({ registrationId: 'r1', bankDate: '2026-01-02' });
    await tools.setPaymentDate({ registrationId: 'r1', bankDate: '2026-01-03' });
    await tools.addPayment({ registrationId: 'r1', amount: 12.5, bankDate: '2026-01-04' });
    await tools.resendPaymentEmail({ registrationId: 'r1' });

    expect(registrations.approve).toHaveBeenCalledWith('r1', 'coop-from-auth', 'u1');
    expect(registrations.reject).toHaveBeenCalledWith('r1', 'coop-from-auth', 'u1', 'Not eligible');
    expect(registrations.cancel).toHaveBeenCalledWith('r1', 'coop-from-auth', 'u1', 'Duplicate');
    expect(registrations.createTransfer).toHaveBeenCalledWith({
      coopId: 'coop-from-auth',
      fromShareholderId: 's1',
      toShareholderId: 's2',
      registrationId: 'r1',
      quantity: 2,
      processedByUserId: 'u1',
    });
    expect(registrations.createBuy).toHaveBeenCalledWith({
      coopId: 'coop-from-auth',
      shareholderId: 's1',
      shareClassId: 'sc1',
      quantity: 3,
      projectId: 'p1',
      isSavings: true,
    });
    expect(registrations.createSell).toHaveBeenCalledWith({
      coopId: 'coop-from-auth',
      shareholderId: 's1',
      registrationId: 'r1',
      quantity: 1,
    });
    expect(registrations.getPaymentDetails).toHaveBeenCalledWith('r1', 'coop-from-auth');
    expect(registrations.complete).toHaveBeenCalledWith(
      'r1',
      'u1',
      new Date('2026-01-02'),
      'coop-from-auth',
    );
    expect(registrations.updatePaymentDate).toHaveBeenCalledWith(
      'r1',
      'coop-from-auth',
      new Date('2026-01-03'),
    );
    expect(payments.addPayment).toHaveBeenCalledWith({
      registrationId: 'r1',
      coopId: 'coop-from-auth',
      amount: 12.5,
      bankDate: new Date('2026-01-04'),
      matchedByUserId: 'u1',
    });
    expect(registrations.resendPaymentEmail).toHaveBeenCalledWith('r1', 'coop-from-auth');
  });
});
