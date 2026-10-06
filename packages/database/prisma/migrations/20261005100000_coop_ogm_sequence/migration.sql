-- AlterTable
ALTER TABLE "coops" ADD COLUMN "ogmSequence" INTEGER NOT NULL DEFAULT 0;

-- Initialise the counter from the highest sequence already handed out per
-- coop, parsed from the stored OGM codes (digits 4-10 of the 12-digit body).
-- Not from a count: deleted or imported registrations leave gaps and
-- out-of-order codes. GREATEST keeps a re-run from lowering a live counter.
-- The DB spec executes everything below this marker.
-- BACKFILL
UPDATE "coops" c
SET "ogmSequence" = GREATEST(c."ogmSequence", s.max_seq)
FROM (
  SELECT c2."id" AS coop_id,
         MAX(SUBSTRING(regexp_replace(r."ogmCode", '\D', '', 'g') FROM 4 FOR 7)::INTEGER) AS max_seq
  FROM "coops" c2
  JOIN "registrations" r
    ON r."ogmCode" IS NOT NULL
   AND length(regexp_replace(r."ogmCode", '\D', '', 'g')) = 12
   AND LEFT(regexp_replace(r."ogmCode", '\D', '', 'g'), 3) = c2."ogmPrefix"
  GROUP BY c2."id"
) s
WHERE s.coop_id = c."id";
