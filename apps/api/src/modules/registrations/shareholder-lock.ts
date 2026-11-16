import { Prisma } from '@opencoop/database';

/**
 * Lock the given shareholders' rows until the surrounding transaction ends.
 *
 * Every path that sells or transfers shares (createSell, createTransfer, transferShares)
 * takes this lock before it re-checks available shares, so two of them cannot both pass
 * the check against the same buy. Rows are locked in id order, so two transfers in
 * opposite directions cannot deadlock.
 */
export async function lockShareholders(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  coopId: string,
  shareholderIds: string[],
): Promise<void> {
  const ids = [...new Set(shareholderIds)].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM shareholders WHERE id IN (${Prisma.join(ids)}) AND "coopId" = ${coopId} ORDER BY id FOR UPDATE`,
  );
}

/** Interactive-transaction timeout for paths that wait on lockShareholders. */
export const SHAREHOLDER_LOCK_TX_OPTIONS = { timeout: 30_000 };
