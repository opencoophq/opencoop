-- Optional Brevo prospects list. Nullable, no default, no rewrite.
-- Safe on production: additive column only, existing rows stay NULL.
ALTER TABLE "coops" ADD COLUMN "brevoProspectsListId" TEXT;
