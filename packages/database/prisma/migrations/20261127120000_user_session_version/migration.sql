-- Additive only. A constant default is a catalog change in PostgreSQL 11+,
-- so this does not rewrite the users table.
ALTER TABLE "users" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
