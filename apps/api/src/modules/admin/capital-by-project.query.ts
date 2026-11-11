import { Prisma } from '@opencoop/database';

/**
 * Capital by project. Payments are summed per registration first so a
 * savings plan with several instalments does not multiply `registrations.quantity`.
 * A date window keeps only registrations that have a payment inside it,
 * matching the previous `p."bankDate"` filter.
 */
export function capitalByProjectQuery(
  coopId: string,
  since: Date | null,
  until: Date | null,
): Prisma.Sql {
  const paymentFilters: Prisma.Sql[] = [];
  if (since) paymentFilters.push(Prisma.sql`AND p."bankDate" >= ${since}`);
  if (until) paymentFilters.push(Prisma.sql`AND p."bankDate" <= ${until}`);
  const paymentWhere = paymentFilters.length > 0 ? Prisma.join(paymentFilters, ' ') : Prisma.empty;
  const requirePayment =
    since || until ? Prisma.sql`AND pay."registrationId" IS NOT NULL` : Prisma.empty;

  return Prisma.sql`
    SELECT
      r."projectId" AS project_id,
      proj.name AS project_name,
      COALESCE(SUM(CASE WHEN r.type = 'BUY' THEN pay.amount ELSE -pay.amount END), 0)::text AS total_capital,
      COALESCE(SUM(CASE WHEN r.type = 'BUY' THEN r.quantity
                        WHEN r.type = 'SELL' THEN -r.quantity
                        ELSE 0 END), 0)::text AS share_count
    FROM registrations r
    LEFT JOIN (
      SELECT p."registrationId", SUM(p.amount) AS amount
      FROM payments p
      WHERE TRUE
      ${paymentWhere}
      GROUP BY p."registrationId"
    ) pay ON pay."registrationId" = r.id
    LEFT JOIN projects proj
      ON proj.id = r."projectId"
      AND proj."coopId" = ${coopId}
    WHERE r."coopId" = ${coopId}
      AND r.status IN ('ACTIVE', 'COMPLETED')
      ${requirePayment}
    GROUP BY r."projectId", proj.name
    ORDER BY total_capital DESC
  `;
}
