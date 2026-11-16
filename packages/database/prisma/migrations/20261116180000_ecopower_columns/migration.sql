-- The EcoPower enum and columns were added to schema.prisma without a migration.
-- Prod and acc already have them (added by hand or by db push), so this migration
-- changes nothing there. On a fresh database it creates them.
-- Every statement is idempotent and additive.

DO $$ BEGIN
  CREATE TYPE "EcoPowerThresholdType" AS ENUM ('EURO', 'SHARES');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "coops" ADD COLUMN IF NOT EXISTS "ecoPowerEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "coops" ADD COLUMN IF NOT EXISTS "ecoPowerMinThreshold" DECIMAL(10,2);
ALTER TABLE "coops" ADD COLUMN IF NOT EXISTS "ecoPowerMinThresholdType" "EcoPowerThresholdType";

ALTER TABLE "shareholders" ADD COLUMN IF NOT EXISTS "ecoPowerId" TEXT;
ALTER TABLE "shareholders" ADD COLUMN IF NOT EXISTS "isEcoPowerClient" BOOLEAN NOT NULL DEFAULT false;
