jest.mock('../../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BankTransactionMatchStatus } from '@opencoop/database';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { BankImportService } from '../../bank-import/bank-import.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import {
  importBankCsvParameters,
  listBankTransactionsParameters,
  McpBankTools,
} from './mcp-bank.tools';

describe('McpBankTools', () => {
  let tools: McpBankTools;
  let scope: 'READ_ONLY' | 'READ_WRITE' = 'READ_WRITE';
  const auth = {
    getUserId: () => 'user-from-auth',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'key-1',
    getScope: () => scope,
  };
  const permissions = { permissions: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const bankImportService = {
    getImports: jest.fn(),
    getTransactions: jest.fn(),
    getUnmatchedTransactions: jest.fn(),
    manualMatch: jest.fn(),
    importCsvText: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpBankTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: BankImportService, useValue: bankImportService },
      ],
    }).compile();
    tools = module.get(McpBankTools);
    jest.clearAllMocks();
    scope = 'READ_WRITE';
    permissions.permissions.mockResolvedValue({ canManageTransactions: true });
    billing.isReadOnly.mockResolvedValue(false);
    bankImportService.getImports.mockResolvedValue([{ id: 'import-1' }]);
    bankImportService.getTransactions.mockResolvedValue([{ id: 'transaction-1' }]);
    bankImportService.getUnmatchedTransactions.mockResolvedValue([{ id: 'transaction-2' }]);
    bankImportService.manualMatch.mockResolvedValue({ success: true });
    bankImportService.importCsvText.mockResolvedValue({ id: 'import-2' });
  });

  it('passes the authenticated coop to every bank service operation', async () => {
    await tools.listBankImports({});
    await tools.listBankTransactions({
      bankImportId: 'import-1',
      matchStatus: BankTransactionMatchStatus.UNMATCHED,
      search: 'Ada',
    });
    await tools.listUnmatchedBankTransactions({});
    await tools.matchBankTransaction({
      bankTransactionId: 'transaction-1',
      registrationId: 'registration-1',
    });
    await tools.importBankCsv({
      csvText: 'date;amount;counterparty;reference\n2026-01-01;10;Ada;reference',
      fileName: 'bank.csv',
      preset: 'generic',
    });

    expect(bankImportService.getImports).toHaveBeenCalledWith('coop-from-auth');
    expect(bankImportService.getTransactions).toHaveBeenCalledWith(
      'coop-from-auth',
      'import-1',
      BankTransactionMatchStatus.UNMATCHED,
      'Ada',
    );
    expect(bankImportService.getUnmatchedTransactions).toHaveBeenCalledWith('coop-from-auth');
    expect(bankImportService.manualMatch).toHaveBeenCalledWith(
      'transaction-1',
      'registration-1',
      'user-from-auth',
      'coop-from-auth',
    );
    expect(bankImportService.importCsvText).toHaveBeenCalledWith(
      'coop-from-auth',
      'user-from-auth',
      'bank.csv',
      'date;amount;counterparty;reference\n2026-01-01;10;Ada;reference',
      'generic',
    );
  });

  it('uses authenticated values when input attempts to provide a different coop', async () => {
    expect(listBankTransactionsParameters.safeParse({ coopId: 'other-coop' }).success).toBe(false);

    await tools.matchBankTransaction({
      bankTransactionId: 'transaction-1',
      registrationId: 'registration-1',
    });

    expect(bankImportService.manualMatch).toHaveBeenCalledWith(
      'transaction-1',
      'registration-1',
      'user-from-auth',
      'coop-from-auth',
    );
  });

  it('propagates a service-level tenant isolation failure', async () => {
    bankImportService.manualMatch.mockRejectedValue(
      new NotFoundException('Bank transaction not found'),
    );

    await expect(
      tools.matchBankTransaction({
        bankTransactionId: 'transaction-1',
        registrationId: 'registration-1',
      }),
    ).rejects.toBeInstanceOf(McpError);
    expect(bankImportService.manualMatch).toHaveBeenCalledWith(
      'transaction-1',
      'registration-1',
      'user-from-auth',
      'coop-from-auth',
    );
  });

  it('rejects without canManageTransactions', async () => {
    permissions.permissions.mockResolvedValue({});

    await expect(tools.listBankImports({})).rejects.toBeInstanceOf(McpError);
    expect(bankImportService.getImports).not.toHaveBeenCalled();
  });

  it('rejects write tools for a READ_ONLY key', async () => {
    scope = 'READ_ONLY';

    await expect(
      tools.importBankCsv({
        csvText: 'date;amount;counterparty;reference\n2026-01-01;10;Ada;reference',
      }),
    ).rejects.toBeInstanceOf(McpError);
    expect(bankImportService.importCsvText).not.toHaveBeenCalled();
  });

  it('validates CSV input and strict parameters', () => {
    expect(importBankCsvParameters.safeParse({ csvText: '' }).success).toBe(false);
    expect(importBankCsvParameters.safeParse({ csvText: 'data', unexpected: true }).success).toBe(
      false,
    );
    expect(listBankTransactionsParameters.safeParse({ matchStatus: 'NOT_A_STATUS' }).success).toBe(
      false,
    );
  });
});
