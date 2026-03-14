-- Update referral code format from BRG-XXXXX to firstname1234 style.
-- Uses the shareholder's firstName (normalized: lowercase, non-alpha stripped)
-- combined with 4 deterministic digits derived from the shareholder id.
-- Falls back to 'coop' prefix when firstName is null or empty.

UPDATE "shareholders"
SET "referralCode" =
  COALESCE(
    NULLIF(
      LOWER(REGEXP_REPLACE(COALESCE("firstName", ''), '[^a-zA-Z]', '', 'g')),
      ''
    ),
    'coop'
  ) ||
  LPAD((1000 + ABS(hashtext(id::text || 'v2code')) % 9000)::text, 4, '0')
WHERE "referralCode" IS NOT NULL;
