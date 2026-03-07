-- Fix SELL registration and payment dates
--
-- The initial migration incorrectly used the share's original purchaseDate
-- (e.g. 2012) for SELL registrations/payments instead of the transaction's
-- createdAt (e.g. 2026). This corrective migration fixes both.

-- Fix SELL registration registerDate
UPDATE "registrations"
SET "registerDate" = "createdAt"
WHERE "type" = 'SELL';

-- Fix SELL payment bankDate and matchedAt
UPDATE "payments" p
SET
    "bankDate" = p."createdAt",
    "matchedAt" = p."createdAt"
FROM "registrations" r
WHERE p."registrationId" = r.id
  AND r."type" = 'SELL';
