-- Additive nullable column. Existing active and trialing rows stay null.
-- Currently lapsed rows are backfilled from the best timestamp we already
-- have, so a coop that lapsed months ago does not receive a fresh 14-day
-- public-signup window, and one that lapsed recently keeps the remainder.
ALTER TABLE "subscriptions" ADD COLUMN "lapsedAt" TIMESTAMP(3);

UPDATE "subscriptions"
SET "lapsedAt" = COALESCE(
  "canceledAt",
  CASE
    WHEN "currentPeriodEnd" IS NOT NULL AND "currentPeriodEnd" < CURRENT_TIMESTAMP
      THEN "currentPeriodEnd"
    ELSE NULL
  END,
  "updatedAt"
)
WHERE "status" IN ('PAST_DUE', 'CANCELED', 'UNPAID', 'INCOMPLETE')
  AND "lapsedAt" IS NULL;
