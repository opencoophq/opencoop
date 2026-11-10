-- Tenant-bound DNS proof for the coop sender domain, plus a revision counter
-- used as a compare-and-swap guard.
--
-- Additive on PostgreSQL 16:
--   * senderDomainProofToken and senderDomainProofAt are nullable, no default,
--     no backfill. Every existing row stays NULL, meaning "no proof".
--   * senderDomainRevision is nullable with a constant DEFAULT 0. Since
--     PostgreSQL 11 a constant default is stored in the catalog, so existing
--     rows read as 0 without a table rewrite and without a backfill.
--   * No drops, no type changes, no data rewrite.
--
-- Locks: each ALTER TABLE ... ADD COLUMN takes a brief ACCESS EXCLUSIVE lock
-- on "coops". The lock is held for catalog work only (milliseconds on a small
-- table), but the statement queues behind any long-running transaction that
-- touches "coops", and new queries queue behind it. Run it when no long
-- transaction is open. This is a short lock, not zero lock.

ALTER TABLE "coops" ADD COLUMN "senderDomainProofToken" TEXT;
ALTER TABLE "coops" ADD COLUMN "senderDomainProofAt" TIMESTAMP(3);
ALTER TABLE "coops" ADD COLUMN "senderDomainRevision" INTEGER DEFAULT 0;
