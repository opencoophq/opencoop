import { Injectable } from '@nestjs/common';
import { BankTransactionMatchStatus } from '@opencoop/database';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { maskShareholderPII } from '../../../common/utils/mask-pii';
import { BankImportService } from '../../bank-import/bank-import.service';
import { BANK_PRESETS } from '../../bank-import/bank-presets';
import { McpToolkit } from '../mcp-toolkit';

const bankPreset = z.enum(Object.keys(BANK_PRESETS) as [string, ...string[]]);

export const listBankImportsParameters = z.object({}).strict();

export const listBankTransactionsParameters = z
  .object({
    bankImportId: z.string().optional().describe('Filter by bank import ID'),
    matchStatus: z
      .nativeEnum(BankTransactionMatchStatus)
      .optional()
      .describe('Filter by match status: UNMATCHED, AUTO_MATCHED, or MANUAL_MATCHED'),
    search: z.string().optional().describe('Search counterparty names and payment reference text'),
  })
  .strict();

export const listUnmatchedBankTransactionsParameters = z.object({}).strict();

export const matchBankTransactionParameters = z
  .object({
    bankTransactionId: z.string().describe('The bank transaction ID'),
    registrationId: z.string().describe('The registration ID to link'),
  })
  .strict();

export const importBankCsvParameters = z
  .object({
    csvText: z.string().min(1).describe('CSV text containing bank transactions'),
    fileName: z.string().optional().describe('Filename to record for this import'),
    preset: bankPreset.optional().describe('Bank CSV preset, defaulting to generic'),
  })
  .strict();

type ListBankTransactionsParams = z.infer<typeof listBankTransactionsParameters>;
type MatchBankTransactionParams = z.infer<typeof matchBankTransactionParameters>;
type ImportBankCsvParams = z.infer<typeof importBankCsvParameters>;

@Injectable()
export class McpBankTools {
  constructor(
    private readonly bankImportService: BankImportService,
    private readonly toolkit: McpToolkit,
  ) {}

  // Mirrors GET admin/coops/:coopId/bank-imports
  @Tool({
    name: 'list_bank_imports',
    description:
      'List CSV bank import batches with filenames, row counts, matched and unmatched counts, and import dates.',
    parameters: listBankImportsParameters,
  })
  async listBankImports(params: z.infer<typeof listBankImportsParameters>) {
    return this.toolkit.run({ permission: 'canManageTransactions' }, params, async (ctx) =>
      this.bankImportService.getImports(ctx.coopId),
    );
  }

  // Mirrors GET admin/coops/:coopId/bank-transactions
  @Tool({
    name: 'list_bank_transactions',
    description:
      'List bank transactions with optional import, match-status, counterparty, and reference-text filters.',
    parameters: listBankTransactionsParameters,
  })
  async listBankTransactions(params: ListBankTransactionsParams) {
    return this.toolkit.run({ permission: 'canManageTransactions' }, params, async (ctx) => {
      const result = await this.bankImportService.getTransactions(
        ctx.coopId,
        params.bankImportId,
        params.matchStatus,
        params.search,
      );
      if (ctx.canViewPII) return result;
      return result.map((transaction) => ({
        ...transaction,
        matchedPayment: transaction.matchedPayment
          ? {
              ...transaction.matchedPayment,
              registration: transaction.matchedPayment.registration
                ? {
                    ...transaction.matchedPayment.registration,
                    shareholder: transaction.matchedPayment.registration.shareholder
                      ? maskShareholderPII(transaction.matchedPayment.registration.shareholder)
                      : transaction.matchedPayment.registration.shareholder,
                  }
                : transaction.matchedPayment.registration,
            }
          : transaction.matchedPayment,
      }));
    });
  }

  // Mirrors GET admin/coops/:coopId/bank-transactions/unmatched
  @Tool({
    name: 'list_unmatched_bank_transactions',
    description: 'List positive Ponto bank transactions that remain unmatched, newest first.',
    parameters: listUnmatchedBankTransactionsParameters,
  })
  async listUnmatchedBankTransactions(
    params: z.infer<typeof listUnmatchedBankTransactionsParameters>,
  ) {
    return this.toolkit.run({ permission: 'canManageTransactions' }, params, async (ctx) =>
      this.bankImportService.getUnmatchedTransactions(ctx.coopId),
    );
  }

  // Mirrors POST admin/coops/:coopId/bank-transactions/:id/match
  @Tool({
    name: 'match_bank_transaction',
    description:
      "Manually link one bank transaction to one registration's payment. This changes state and can complete the registration when it becomes fully paid; this tool has no reverse action.",
    parameters: matchBankTransactionParameters,
  })
  async matchBankTransaction(params: MatchBankTransactionParams) {
    return this.toolkit.run(
      { permission: 'canManageTransactions', write: true },
      params,
      async (ctx) =>
        this.bankImportService.manualMatch(
          ctx.coopId,
          params.bankTransactionId,
          params.registrationId,
          ctx.userId,
        ),
    );
  }

  // Mirrors POST admin/coops/:coopId/bank-import
  @Tool({
    name: 'import_bank_csv',
    description:
      'Import bank transactions from CSV text and auto-match rows whose references contain known OGM codes. This can complete registrations and create real payment records.',
    parameters: importBankCsvParameters,
  })
  async importBankCsv(params: ImportBankCsvParams) {
    return this.toolkit.run(
      { permission: 'canManageTransactions', write: true },
      params,
      async (ctx) =>
        this.bankImportService.importCsvText(
          ctx.coopId,
          ctx.userId,
          params.fileName ?? 'mcp-import.csv',
          params.csvText,
          params.preset ?? 'generic',
        ),
    );
  }
}
