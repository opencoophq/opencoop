-- Volunteer registration (vrijwilligersregistratie).
-- Off by default. Admin roles gain canViewVolunteers; every other role stays
-- without the key, which the API treats as denied.

-- CreateEnum
CREATE TYPE "VolunteerStatus" AS ENUM ('PENDING_CONFIRMATION', 'ACTIVE', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "AudienceType" ADD VALUE IF NOT EXISTS 'VOLUNTEERS';

-- AlterTable
ALTER TABLE "coops" ADD COLUMN "volunteersEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "volunteerInterests" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "audienceVolunteerFilter" JSONB,
ADD COLUMN "audienceVolunteerIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "volunteers" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "shareholderId" TEXT,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "postalCode" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locale" TEXT NOT NULL DEFAULT 'nl',
    "consentAt" TIMESTAMP(3),
    "consentTextVersion" TEXT NOT NULL,
    "status" "VolunteerStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "confirmTokenHash" TEXT,
    "confirmExpiresAt" TIMESTAMP(3),
    "withdrawToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "volunteers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "volunteers_shareholderId_key" ON "volunteers"("shareholderId");

-- CreateIndex
CREATE UNIQUE INDEX "volunteers_confirmTokenHash_key" ON "volunteers"("confirmTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "volunteers_withdrawToken_key" ON "volunteers"("withdrawToken");

-- CreateIndex
CREATE INDEX "volunteers_coopId_status_idx" ON "volunteers"("coopId", "status");

-- CreateIndex
CREATE INDEX "volunteers_coopId_municipality_idx" ON "volunteers"("coopId", "municipality");

-- CreateIndex
CREATE INDEX "volunteers_coopId_postalCode_idx" ON "volunteers"("coopId", "postalCode");

-- CreateIndex
CREATE INDEX "volunteers_status_createdAt_idx" ON "volunteers"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "volunteers_coopId_email_key" ON "volunteers"("coopId", "email");

-- AddForeignKey
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_shareholderId_fkey" FOREIGN KEY ("shareholderId") REFERENCES "shareholders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing Admin roles can open the volunteers page. Other roles stay denied
-- until someone assigns canViewVolunteers. Idempotent.
UPDATE "coop_roles"
SET "permissions" = "permissions" || jsonb_build_object('canViewVolunteers', true)
WHERE "name" = 'Admin' AND NOT ("permissions" ? 'canViewVolunteers');
