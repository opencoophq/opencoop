-- Login email change that waits for proof from the new address.
--
-- Additive on PostgreSQL 16: one nullable column, no default, no backfill,
-- no drops, no type changes. Every existing row stays NULL ("no change
-- pending"). ADD COLUMN takes a brief ACCESS EXCLUSIVE lock on "users" for
-- catalog work only; it queues behind any long-running transaction on
-- "users", so run it when none is open.

ALTER TABLE "users" ADD COLUMN "pendingEmail" TEXT;
