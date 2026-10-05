import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChargeCard, Prisma } from '@opencoop/database';

/** A card can be reported lost while ACTIVE, or BLOCKED for any reason other than LOST. */
export const CAN_REPORT_LOST: Prisma.ChargeCardWhereInput = {
  OR: [{ status: 'ACTIVE' }, { status: 'BLOCKED', blockReason: { not: 'LOST' } }],
};

/**
 * Moves one card from an allowed state to a new state. The update is guarded
 * by `allowed` in the same statement, so two concurrent transitions (a cancel
 * and a payment, say) can never both win.
 *
 * @param scope   who may see the card (shareholder or coop); no match → 404
 * @param allowed the states this transition starts from; no match → 400
 */
export async function transitionCard(
  db: Prisma.TransactionClient,
  scope: Prisma.ChargeCardWhereInput,
  allowed: Prisma.ChargeCardWhereInput,
  data: Prisma.ChargeCardUpdateManyMutationInput,
  refusal: string,
): Promise<ChargeCard> {
  const card = await db.chargeCard.findFirst({ where: scope, select: { id: true } });
  if (!card) {
    throw new NotFoundException('Charge card not found');
  }
  const result = await db.chargeCard.updateMany({ where: { AND: [{ id: card.id }, allowed] }, data });
  if (result.count === 0) {
    throw new BadRequestException(refusal);
  }
  return db.chargeCard.findUniqueOrThrow({ where: { id: card.id } });
}
