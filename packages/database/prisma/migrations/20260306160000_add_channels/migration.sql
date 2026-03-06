-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#1e40af',
    "secondaryColor" TEXT NOT NULL DEFAULT '#3b82f6',
    "termsUrl" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_share_classes" (
    "channelId" TEXT NOT NULL,
    "shareClassId" TEXT NOT NULL,

    CONSTRAINT "channel_share_classes_pkey" PRIMARY KEY ("channelId","shareClassId")
);

-- CreateTable
CREATE TABLE "channel_projects" (
    "channelId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "channel_projects_pkey" PRIMARY KEY ("channelId","projectId")
);

-- CreateIndex
CREATE UNIQUE INDEX "channels_coopId_slug_key" ON "channels"("coopId", "slug");

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_share_classes" ADD CONSTRAINT "channel_share_classes_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_share_classes" ADD CONSTRAINT "channel_share_classes_shareClassId_fkey" FOREIGN KEY ("shareClassId") REFERENCES "share_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_projects" ADD CONSTRAINT "channel_projects_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_projects" ADD CONSTRAINT "channel_projects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- DATA MIGRATION: Move coop branding into default channels
-- ============================================================================

-- Migrate existing coop branding into default channels
INSERT INTO "channels" ("id", "coopId", "slug", "name", "description", "logoUrl", "primaryColor", "secondaryColor", "termsUrl", "isDefault", "active", "createdAt", "updatedAt")
SELECT
  concat('ch_', gen_random_uuid()),
  "id",
  'default',
  "name",
  NULL,
  "logoUrl",
  "primaryColor",
  "secondaryColor",
  "termsUrl",
  true,
  true,
  NOW(),
  NOW()
FROM "coops";

-- Link all share classes to their coop's default channel
INSERT INTO "channel_share_classes" ("channelId", "shareClassId")
SELECT c."id", sc."id"
FROM "channels" c
JOIN "share_classes" sc ON sc."coopId" = c."coopId"
WHERE c."isDefault" = true;

-- Link all projects to their coop's default channel
INSERT INTO "channel_projects" ("channelId", "projectId")
SELECT c."id", p."id"
FROM "channels" c
JOIN "projects" p ON p."coopId" = c."coopId"
WHERE c."isDefault" = true;

-- ============================================================================
-- ADD channelId TO EXISTING TABLES
-- ============================================================================

-- AlterTable: Add channelId to transactions
ALTER TABLE "transactions" ADD COLUMN "channelId" TEXT;

-- AlterTable: Add channelId to shareholders
ALTER TABLE "shareholders" ADD COLUMN "channelId" TEXT;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholders" ADD CONSTRAINT "shareholders_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- DROP BRANDING COLUMNS FROM COOPS (after data has been migrated)
-- ============================================================================

-- AlterTable: Remove branding fields from coops
ALTER TABLE "coops" DROP COLUMN "logoUrl",
DROP COLUMN "primaryColor",
DROP COLUMN "secondaryColor",
DROP COLUMN "termsUrl";
