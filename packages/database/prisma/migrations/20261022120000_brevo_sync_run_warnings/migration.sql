-- Run-level warnings (missing Brevo attributes) that must not fail the run.
-- Nullable, no default, no rewrite. Safe on production: additive column only.
ALTER TABLE "BrevoSyncRun" ADD COLUMN "warnings" JSONB;
