import { Test } from '@nestjs/testing';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
jest.mock('../../registrations/share-transfer.service', () => ({
  ShareTransferService: class ShareTransferService {},
}));
jest.mock('../../registrations/registrations.service', () => ({
  RegistrationsService: class RegistrationsService {},
}));
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { ShareTransferService } from '../../registrations/share-transfer.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import {
  McpShareTransferTools,
  previewShareTransferParameters,
  transferSharesParameters,
} from './mcp-share-transfer.tools';

describe('McpShareTransferTools', () => {
  let tools: McpShareTransferTools;
  let keyScope: 'READ_ONLY' | 'READ_WRITE' = 'READ_WRITE';
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'k1',
    getScope: () => keyScope,
  };
  const permissions = { permissions: jest.fn(), permissionsWithRole: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const shareTransfers = { previewTransfer: jest.fn(), transferShares: jest.fn() };

  const params = {
    fromShareholderId: 'shareholder-alice',
    toShareholderId: 'shareholder-bob',
    shareClassId: 'class-a',
    quantity: 4,
    transferDate: '2026-03-01',
    reason: 'INHERITANCE' as const,
  };

  const party = (id: string, name: string) => ({
    id,
    name,
    deceasedAt: null,
    before: { sharesInClass: 4, valueInClassEur: 1000, totalShares: 4, totalValueEur: 1000 },
    after: null,
    statusBefore: 'ACTIVE',
    statusAfter: null,
  });

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpShareTransferTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: ShareTransferService, useValue: shareTransfers },
      ],
    }).compile();
    tools = module.get(McpShareTransferTools);
    jest.clearAllMocks();
    keyScope = 'READ_WRITE';
    permissions.permissions.mockResolvedValue({ canManageTransactions: true, canViewPII: true });
    permissions.permissionsWithRole.mockImplementation(async () => ({
      permissions: await permissions.permissions(),
      role: 'COOP_ADMIN',
    }));
    billing.isReadOnly.mockResolvedValue(false);
    shareTransfers.previewTransfer.mockResolvedValue({
      valid: true,
      errors: [],
      from: party('shareholder-alice', 'Alice Testperson'),
      to: party('shareholder-bob', 'Bob Testperson'),
    });
    shareTransfers.transferShares.mockResolvedValue({
      transfer: { id: 't1' },
      idempotentReplay: false,
    });
  });

  it('registers the tools under their exact names', () => {
    const names = ['previewShareTransfer', 'transferShares'].map(
      (method) =>
        Reflect.getMetadata(
          'mcp:tool',
          McpShareTransferTools.prototype[method as keyof McpShareTransferTools],
        )?.name,
    );
    expect(names).toEqual(['preview_share_transfer', 'transfer_shares']);
  });

  it('previews with the authenticated coop and works with a read-only key', async () => {
    keyScope = 'READ_ONLY';

    const result = await tools.previewShareTransfer(params);

    expect(shareTransfers.previewTransfer).toHaveBeenCalledWith({
      ...params,
      coopId: 'coop-from-auth',
    });
    expect(result).toMatchObject({ valid: true, from: { name: 'Alice Testperson' } });
    expect(shareTransfers.transferShares).not.toHaveBeenCalled();
  });

  it('masks shareholder names in the preview without canViewPII', async () => {
    permissions.permissions.mockResolvedValue({ canManageTransactions: true, canViewPII: false });

    const result = (await tools.previewShareTransfer(params)) as any;

    expect(result.from.name).toBe('Aandeelhouder #lice');
    expect(result.to.name).toBe('Aandeelhouder #-bob');
  });

  it('transfers with the authenticated coop and the key owner as processor', async () => {
    await tools.transferShares({ ...params, idempotencyKey: 'key-1', note: 'Erfopvolging' });

    expect(shareTransfers.transferShares).toHaveBeenCalledWith({
      ...params,
      idempotencyKey: 'key-1',
      note: 'Erfopvolging',
      coopId: 'coop-from-auth',
      processedByUserId: 'u1',
    });
  });

  it('refuses transfer_shares for a read-only key and does not call the service', async () => {
    keyScope = 'READ_ONLY';

    const call = tools.transferShares(params);

    await expect(call).rejects.toBeInstanceOf(McpError);
    await expect(call).rejects.toThrow('This API key is read-only');
    expect(shareTransfers.transferShares).not.toHaveBeenCalled();
  });

  it('requires canManageTransactions for both tools', async () => {
    permissions.permissions.mockResolvedValue({});

    await expect(tools.previewShareTransfer(params)).rejects.toThrow('Insufficient permissions');
    await expect(tools.transferShares(params)).rejects.toThrow('Insufficient permissions');
    expect(shareTransfers.previewTransfer).not.toHaveBeenCalled();
    expect(shareTransfers.transferShares).not.toHaveBeenCalled();
  });

  it('does not accept a coopId from the client', () => {
    expect(previewShareTransferParameters.safeParse({ ...params, coopId: 'other' }).success).toBe(
      false,
    );
    expect(transferSharesParameters.safeParse({ ...params, coopId: 'other' }).success).toBe(false);
  });

  it('validates the parameters', () => {
    expect(transferSharesParameters.safeParse(params).success).toBe(true);
    expect(transferSharesParameters.safeParse({ ...params, quantity: 0 }).success).toBe(false);
    expect(transferSharesParameters.safeParse({ ...params, reason: 'DEATH' }).success).toBe(false);
    expect(
      transferSharesParameters.safeParse({ ...params, transferDate: '01/03/2026' }).success,
    ).toBe(false);
    expect(transferSharesParameters.safeParse({ ...params, note: 'x'.repeat(1001) }).success).toBe(
      false,
    );
    expect(
      transferSharesParameters.safeParse({ ...params, idempotencyKey: 'k'.repeat(201) }).success,
    ).toBe(false);
    expect(
      previewShareTransferParameters.safeParse({ ...params, idempotencyKey: 'k' }).success,
    ).toBe(false);
  });
});
