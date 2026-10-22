-- Additive audience-sync counters.
-- Safe on production (PostgreSQL 11+): each ADD COLUMN uses a constant DEFAULT,
-- so Postgres updates the catalog only and does not rewrite "BrevoSyncRun".
-- No drops, no type changes, no locks beyond a brief catalog update.
ALTER TABLE "BrevoSyncRun" ADD COLUMN "created" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BrevoSyncRun" ADD COLUMN "unlinked" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BrevoSyncRun" ADD COLUMN "noop" INTEGER NOT NULL DEFAULT 0;

-- Historical runs stored creates in `added`. Copy that forward once.
UPDATE "BrevoSyncRun" SET "created" = "added" WHERE "added" <> 0;
