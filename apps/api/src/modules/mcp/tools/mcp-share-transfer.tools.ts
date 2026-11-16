import { Injectable } from '@nestjs/common';
import { TransferReason } from '@opencoop/database';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import {
  ShareTransferPreview,
  ShareTransferService,
  TransferPartyPreview,
} from '../../registrations/share-transfer.service';
import { McpToolkit } from '../mcp-toolkit';
import { isoDate } from './mcp-transaction.tools';

const shareTransferFields = {
  fromShareholderId: z
    .string()
    .describe('Shareholder who gives up the shares (for an inheritance: the deceased)'),
  toShareholderId: z
    .string()
    .describe('Existing shareholder of the same coop who receives the shares'),
  shareClassId: z.string().describe('Share class to transfer'),
  quantity: z.number().int().min(1).describe('Number of shares to transfer'),
  transferDate: isoDate.describe(
    'Date of the transfer (ISO 8601, e.g. 2026-03-01). Today or earlier, Europe/Brussels calendar day.',
  ),
  reason: z
    .nativeEnum(TransferReason)
    .describe(
      'Why the shares move: INHERITANCE (inheritance / erfopvolging after a death), SALE, GIFT, or OTHER',
    ),
  note: z.string().max(1000).optional().describe('Free-text note stored with the transfer'),
  markFromAsDeceased: z
    .boolean()
    .optional()
    .describe(
      'INHERITANCE only. Record the source as deceased. This happens anyway when the source keeps no shares.',
    ),
  dateOfDeath: isoDate
    .optional()
    .describe('INHERITANCE only. Date of death to record; defaults to transferDate.'),
};

export const previewShareTransferParameters = z.object(shareTransferFields).strict();

export const transferSharesParameters = z
  .object({
    ...shareTransferFields,
    idempotencyKey: z
      .string()
      .max(200)
      .optional()
      .describe(
        'Optional key that makes a retry safe. Without it, the same parties, class, quantity, date and reason count as one transfer.',
      ),
  })
  .strict();

type PreviewShareTransferParams = z.infer<typeof previewShareTransferParameters>;
type TransferSharesParams = z.infer<typeof transferSharesParameters>;

@Injectable()
export class McpShareTransferTools {
  constructor(
    private readonly shareTransfers: ShareTransferService,
    private readonly toolkit: McpToolkit,
  ) {}

  @Tool({
    name: 'preview_share_transfer',
    description:
      'Check a share transfer between two existing shareholders of this coop and show its effect. This does not write anything. Returns every validation error, the FIFO allocation over the source buys, the value, both holdings and statuses before and after, and whether the source will be recorded as deceased.',
    parameters: previewShareTransferParameters,
  })
  async previewShareTransfer(params: PreviewShareTransferParams) {
    return this.toolkit.run({ permission: 'canManageTransactions' }, params, async (ctx) => {
      const preview = await this.shareTransfers.previewTransfer({ ...params, coopId: ctx.coopId });
      return ctx.canViewPII ? preview : this.maskNames(preview);
    });
  }

  @Tool({
    name: 'transfer_shares',
    description:
      'Irreversibly transfer shares of one class between two existing shareholders of this coop, for example an inheritance (erfopvolging). Writes a SELL for the source and a BUY for the recipient per consumed buy, so total capital does not change. For INHERITANCE it records the source as deceased when asked or when no shares remain. Call preview_share_transfer first.',
    parameters: transferSharesParameters,
  })
  async transferShares(params: TransferSharesParams) {
    return this.toolkit.run(
      { permission: 'canManageTransactions', write: true },
      params,
      async (ctx) =>
        this.shareTransfers.transferShares({
          ...params,
          coopId: ctx.coopId,
          processedByUserId: ctx.userId,
        }),
    );
  }

  /** Same label the toolkit uses for masked shareholder names. */
  private maskNames(preview: ShareTransferPreview): ShareTransferPreview {
    const mask = (party: TransferPartyPreview | null) =>
      party ? { ...party, name: `Aandeelhouder #${party.id.slice(-4)}` } : null;
    return { ...preview, from: mask(preview.from), to: mask(preview.to) };
  }
}
