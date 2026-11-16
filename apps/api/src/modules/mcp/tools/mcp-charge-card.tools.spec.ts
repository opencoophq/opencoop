jest.mock('../../coops/coops.service', () => ({
  CoopsService: class CoopsService {},
}));
jest.mock('../../charge-cards/charge-cards-admin.service', () => ({
  ChargeCardsAdminService: class ChargeCardsAdminService {},
}));

import { Test } from '@nestjs/testing';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { ChargeCardsAdminService } from '../../charge-cards/charge-cards-admin.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import { McpChargeCardTools, listChargeCardsParameters } from './mcp-charge-card.tools';

const ROW = {
  id: 'card-1',
  label: 'Auto Fien',
  status: 'ACTIVE',
  blockReason: null,
  ogmCode: '+++090/9337/55493+++',
  cardNumber: 'NL-123',
  feeInclVat: 6,
  isReplacement: false,
  replacesCardId: null,
  replaced: false,
  providerSyncNeeded: false,
  requestedAt: new Date('2026-10-01T08:00:00Z'),
  paidAt: new Date('2026-10-02T08:00:00Z'),
  issuedAt: new Date('2026-10-05T08:00:00Z'),
  blockedAt: null,
  activatedAt: new Date('2026-10-05T08:00:00Z'),
  shareholderId: 'sh-abcd1234',
  shareholderName: 'Fien Vermeulen',
  shareholderEmail: 'fien@example.be',
  shareholderNumber: 42,
  shareholderStatus: 'ACTIVE',
  totalPaid: 6,
  waitingWorkingDays: null,
  overdue: false,
};

const EXPECTED = {
  id: 'card-1',
  label: 'Auto Fien',
  status: 'ACTIVE',
  blockReason: null,
  requestedAt: '2026-10-01T08:00:00.000Z',
  paidAt: '2026-10-02T08:00:00.000Z',
  issuedAt: '2026-10-05T08:00:00.000Z',
  cardNumber: 'NL-123',
  shareholderId: 'sh-abcd1234',
  shareholderNumber: 42,
  shareholderName: 'Fien Vermeulen',
  shareholderEmail: 'fien@example.be',
};

describe('McpChargeCardTools', () => {
  let tools: McpChargeCardTools;
  let toolkit: McpToolkit;
  let role = 'COOP_ADMIN';
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'k1',
    getScope: () => 'READ_ONLY' as const,
  };
  const permissions = { permissions: jest.fn(), permissionsWithRole: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const chargeCards = { list: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpChargeCardTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: ChargeCardsAdminService, useValue: chargeCards },
      ],
    }).compile();
    tools = module.get(McpChargeCardTools);
    toolkit = module.get(McpToolkit);
    jest.clearAllMocks();
    role = 'COOP_ADMIN';
    permissions.permissionsWithRole.mockImplementation(async () => ({
      permissions: await permissions.permissions(),
      role,
    }));
    billing.isReadOnly.mockResolvedValue(true);
    chargeCards.list.mockResolvedValue([ROW]);
  });

  it('lets a READ_ONLY key with only canViewChargeCards list the cards of its own coop', async () => {
    permissions.permissions.mockResolvedValue({ canViewChargeCards: true, canViewPII: true });

    const result = await tools.listChargeCards({ status: 'ACTIVE', todo: true });

    expect(result).toEqual([EXPECTED]);
    expect(chargeCards.list).toHaveBeenCalledWith('coop-from-auth', {
      status: 'ACTIVE',
      todo: true,
    });
  });

  it('lets canManageShareholders alone list the cards', async () => {
    permissions.permissions.mockResolvedValue({ canManageShareholders: true, canViewPII: true });
    await expect(tools.listChargeCards({})).resolves.toEqual([EXPECTED]);
    expect(chargeCards.list).toHaveBeenCalledWith('coop-from-auth', {
      status: undefined,
      todo: false,
    });
  });

  it('refuses a key without canViewChargeCards or canManageShareholders', async () => {
    permissions.permissions.mockResolvedValue({
      canViewChargeCards: false,
      canViewPII: true,
      canViewReports: true,
    });

    await expect(tools.listChargeCards({})).rejects.toBeInstanceOf(McpError);
    await expect(tools.listChargeCards({})).rejects.toThrow('Insufficient permissions');
    expect(chargeCards.list).not.toHaveBeenCalled();
  });

  it('lets SYSTEM_ADMIN list without the permissions', async () => {
    role = 'SYSTEM_ADMIN';
    permissions.permissions.mockResolvedValue({});
    await expect(tools.listChargeCards({})).resolves.toHaveLength(1);
  });

  it('masks name and email once, with the member-number label, without canViewPII', async () => {
    permissions.permissions.mockResolvedValue({ canViewChargeCards: true, canViewPII: false });

    const result = await tools.listChargeCards({});

    expect(result).toEqual([
      { ...EXPECTED, shareholderName: 'Aandeelhouder #42', shareholderEmail: '***' },
    ]);
  });

  it('keeps a missing email null and falls back to the id suffix without canViewPII', async () => {
    permissions.permissions.mockResolvedValue({ canViewChargeCards: true, canViewPII: false });
    chargeCards.list.mockResolvedValue([
      { ...ROW, shareholderNumber: null, shareholderEmail: null },
    ]);

    const [card] = (await tools.listChargeCards({})) as Array<Record<string, unknown>>;

    expect(card).toEqual({
      ...EXPECTED,
      shareholderNumber: null,
      shareholderName: 'Aandeelhouder #1234',
      shareholderEmail: null,
    });
  });

  it('the toolkit alone masks an unmasked card row the same way, without adding shareholder keys', async () => {
    permissions.permissions.mockResolvedValue({ canViewChargeCards: true, canViewPII: false });

    const result = await toolkit.run(
      { anyPermission: ['canViewChargeCards'] },
      undefined,
      async () => [{ ...EXPECTED }],
    );

    expect(result).toEqual([
      { ...EXPECTED, shareholderName: 'Aandeelhouder #42', shareholderEmail: '***' },
    ]);
  });

  it('rejects a coop id argument and an unknown status', () => {
    expect(listChargeCardsParameters.safeParse({ coopId: 'other-coop' }).success).toBe(false);
    expect(listChargeCardsParameters.safeParse({ status: 'GONE' }).success).toBe(false);
    expect(listChargeCardsParameters.safeParse({ status: 'PAID', todo: true }).success).toBe(true);
  });
});
