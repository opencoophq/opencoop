import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChargeCard, ChargeCardStatus, Prisma } from '@opencoop/database';

/** A card can be reported lost while ACTIVE, or BLOCKED for any reason other than LOST. */
export const CAN_REPORT_LOST: Prisma.ChargeCardWhereInput = {
  OR: [{ status: 'ACTIVE' }, { status: 'BLOCKED', blockReason: { not: 'LOST' } }],
};

/**
 * The one way a card ever becomes CANCELLED: replacesCardId is always
 * cleared, so a LOST card that this one replaced can be replaced again.
 * Every CANCELLED path (shareholder cancel, admin cancel, Task 7's daily
 * sync) applies this constant instead of writing its own literal.
 */
export const CANCEL_DATA: Prisma.ChargeCardUncheckedUpdateManyInput = {
  status: 'CANCELLED',
  replacesCardId: null,
};

export interface CardLockScope {
  id: string;
  coopId?: string;
  shareholderId?: string;
}

/**
 * Locks one card row (`SELECT ... FOR UPDATE`) inside the caller's
 * transaction, scoped the same way `scope` would scope a Prisma query (by
 * coop or by shareholder), and returns its live id and status. A mismatched
 * id — another coop's or another shareholder's card — locks nothing and
 * returns null, so no row from outside the caller's scope is ever locked or
 * has its state revealed through a later error message.
 *
 * This is the one raw-SQL lock query in the module: a payment
 * (`charge-card-payments.ts`), a cancel and every admin transition all take
 * the lock through this function.
 */
export async function lockCard(
  db: Prisma.TransactionClient,
  scope: CardLockScope,
): Promise<{ id: string; status: ChargeCardStatus } | null> {
  if (scope.shareholderId !== undefined) {
    const rows = await db.$queryRaw<{ id: string; status: ChargeCardStatus }[]>`
      SELECT "id", "status" FROM "charge_cards"
      WHERE "id" = ${scope.id} AND "shareholderId" = ${scope.shareholderId}
      FOR UPDATE`;
    return rows[0] ?? null;
  }
  if (scope.coopId !== undefined) {
    const rows = await db.$queryRaw<{ id: string; status: ChargeCardStatus }[]>`
      SELECT "id", "status" FROM "charge_cards"
      WHERE "id" = ${scope.id} AND "coopId" = ${scope.coopId}
      FOR UPDATE`;
    return rows[0] ?? null;
  }
  const rows = await db.$queryRaw<{ id: string; status: ChargeCardStatus }[]>`
    SELECT "id", "status" FROM "charge_cards"
    WHERE "id" = ${scope.id}
    FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Cancels a card: re-validates its state against `allowedFrom` atomically
 * (via `transitionCard`) and applies `CANCEL_DATA`. The caller must have
 * already locked the row with `lockCard`, inside the same transaction, and
 * checked whatever extra rule its own cancel needs against the locked
 * status (e.g. the shareholder rule: refuse a card that already holds a
 * payment) — `cancelCard` only re-confirms the state, the same way
 * `transitionCard` always does.
 *
 * `tx` is an explicit parameter, not created here, so a batch caller (Task
 * 7's daily sync) can call this once per card id inside one shared
 * `$transaction`.
 */
export async function cancelCard(
  tx: Prisma.TransactionClient,
  scope: Prisma.ChargeCardWhereInput,
  allowedFrom: ChargeCardStatus[],
  refusal: string,
): Promise<ChargeCard> {
  return transitionCard(tx, scope, { status: { in: allowedFrom } }, CANCEL_DATA, refusal);
}

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
  // Unchecked: callers may need to clear replacesCardId (an FK-backed scalar
  // that the checked UpdateManyMutationInput omits), e.g. on cancel.
  data: Prisma.ChargeCardUncheckedUpdateManyInput,
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
