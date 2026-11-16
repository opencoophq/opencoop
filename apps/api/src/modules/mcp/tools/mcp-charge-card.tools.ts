import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ChargeCardStatus } from '@opencoop/database';
import { maskShareholderRowPII } from '../../../common/utils/mask-pii';
import { ChargeCardsAdminService } from '../../charge-cards/charge-cards-admin.service';
import { McpToolkit } from '../mcp-toolkit';

export const listChargeCardsParameters = z
  .object({
    status: z
      .nativeEnum(ChargeCardStatus)
      .optional()
      .describe('Keep cards with this status. Omit for every status.'),
    todo: z
      .boolean()
      .optional()
      .describe('true keeps only cards with a pending change in the provider portal'),
  })
  .strict();

type ListChargeCardsParams = z.infer<typeof listChargeCardsParameters>;

@Injectable()
export class McpChargeCardTools {
  constructor(
    private readonly chargeCards: ChargeCardsAdminService,
    private readonly toolkit: McpToolkit,
  ) {}

  // Mirrors GET admin/coops/:coopId/charge-cards
  @Tool({
    name: 'list_charge_cards',
    description:
      'List the charge cards (laadpassen) of this coop, oldest request first, with the shareholder who registered each card: name, email and member number. Filter by status or by pending provider-portal change. Read-only. Requires canViewChargeCards, canManageChargeCards or canManageShareholders. Without canViewPII, name and email are masked.',
    parameters: listChargeCardsParameters,
  })
  async listChargeCards(params: ListChargeCardsParams) {
    return this.toolkit.run(
      { anyPermission: ['canViewChargeCards', 'canManageChargeCards', 'canManageShareholders'] },
      params,
      async (ctx) => {
        const rows = await this.chargeCards.list(ctx.coopId, {
          status: params?.status,
          todo: params?.todo === true,
        });
        const cards = rows.map((row) => ({
          id: row.id,
          label: row.label,
          status: row.status,
          blockReason: row.blockReason,
          requestedAt: row.requestedAt,
          paidAt: row.paidAt,
          issuedAt: row.issuedAt,
          cardNumber: row.cardNumber,
          shareholderId: row.shareholderId,
          shareholderNumber: row.shareholderNumber,
          shareholderName: row.shareholderName,
          shareholderEmail: row.shareholderEmail,
        }));
        return ctx.canViewPII ? cards : cards.map(maskShareholderRowPII);
      },
    );
  }
}
