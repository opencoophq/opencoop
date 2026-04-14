-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('ANNUAL', 'EXTRAORDINARY', 'WRITTEN');

-- CreateEnum
CREATE TYPE "MeetingFormat" AS ENUM ('PHYSICAL', 'HYBRID', 'DIGITAL');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('DRAFT', 'CONVOKED', 'HELD', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VotingWeight" AS ENUM ('PER_SHAREHOLDER', 'PER_SHARE');

-- CreateEnum
CREATE TYPE "AgendaType" AS ENUM ('INFORMATIONAL', 'RESOLUTION', 'ELECTION');

-- CreateEnum
CREATE TYPE "MajorityType" AS ENUM ('SIMPLE', 'TWO_THIRDS', 'THREE_QUARTERS');

-- CreateEnum
CREATE TYPE "VoteChoice" AS ENUM ('FOR', 'AGAINST', 'ABSTAIN');

-- CreateEnum
CREATE TYPE "RSVPStatus" AS ENUM ('ATTENDING', 'PROXY', 'ABSENT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('ADMIN', 'KIOSK', 'PAPER_RECONCILED');

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "type" "MeetingType" NOT NULL,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 120,
    "location" TEXT,
    "format" "MeetingFormat" NOT NULL,
    "votingWeight" "VotingWeight" NOT NULL DEFAULT 'PER_SHAREHOLDER',
    "maxProxiesPerPerson" INTEGER NOT NULL DEFAULT 1,
    "convocationSentAt" TIMESTAMP(3),
    "convocationDocUrl" TEXT,
    "convocationFailures" JSONB,
    "reminderDaysBefore" INTEGER[] DEFAULT ARRAY[3]::INTEGER[],
    "remindersSent" JSONB DEFAULT '{}',
    "status" "MeetingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_items" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "AgendaType" NOT NULL,

    CONSTRAINT "agenda_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_attachments" (
    "id" TEXT NOT NULL,
    "agendaItemId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agenda_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolutions" (
    "id" TEXT NOT NULL,
    "agendaItemId" TEXT NOT NULL,
    "proposedText" TEXT NOT NULL,
    "majorityType" "MajorityType" NOT NULL,
    "quorumRequired" DECIMAL(65,30),
    "votesFor" INTEGER NOT NULL DEFAULT 0,
    "votesAgainst" INTEGER NOT NULL DEFAULT 0,
    "votesAbstain" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "votes" (
    "id" TEXT NOT NULL,
    "resolutionId" TEXT NOT NULL,
    "shareholderId" TEXT NOT NULL,
    "choice" "VoteChoice" NOT NULL,
    "castViaProxyId" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "castAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxies" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "grantorShareholderId" TEXT NOT NULL,
    "delegateShareholderId" TEXT NOT NULL,
    "signedFormUrl" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "proxies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_attendances" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "shareholderId" TEXT NOT NULL,
    "rsvpStatus" "RSVPStatus" NOT NULL DEFAULT 'UNKNOWN',
    "rsvpAt" TIMESTAMP(3),
    "rsvpToken" TEXT NOT NULL,
    "rsvpTokenExpires" TIMESTAMP(3) NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "checkedInBy" TEXT,
    "checkInMethod" "CheckInMethod",
    "signatureImageUrl" TEXT,

    CONSTRAINT "meeting_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_minutes" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "generatedPdfUrl" TEXT,
    "signedPdfUrl" TEXT,
    "signedAt" TIMESTAMP(3),
    "signedByName" TEXT,

    CONSTRAINT "meeting_minutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_kiosk_sessions" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "startedBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "meeting_kiosk_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meetings_coopId_scheduledAt_idx" ON "meetings"("coopId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_items_meetingId_order_key" ON "agenda_items"("meetingId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "resolutions_agendaItemId_key" ON "resolutions"("agendaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "votes_resolutionId_shareholderId_key" ON "votes"("resolutionId", "shareholderId");

-- CreateIndex
CREATE UNIQUE INDEX "proxies_meetingId_grantorShareholderId_key" ON "proxies"("meetingId", "grantorShareholderId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_attendances_rsvpToken_key" ON "meeting_attendances"("rsvpToken");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_attendances_meetingId_shareholderId_key" ON "meeting_attendances"("meetingId", "shareholderId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_minutes_meetingId_key" ON "meeting_minutes"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_kiosk_sessions_token_key" ON "meeting_kiosk_sessions"("token");

-- CreateIndex
CREATE INDEX "meeting_kiosk_sessions_meetingId_active_idx" ON "meeting_kiosk_sessions"("meetingId", "active");

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_attachments" ADD CONSTRAINT "agenda_attachments_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "agenda_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "agenda_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "resolutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_shareholderId_fkey" FOREIGN KEY ("shareholderId") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_grantorShareholderId_fkey" FOREIGN KEY ("grantorShareholderId") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_delegateShareholderId_fkey" FOREIGN KEY ("delegateShareholderId") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendances" ADD CONSTRAINT "meeting_attendances_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendances" ADD CONSTRAINT "meeting_attendances_shareholderId_fkey" FOREIGN KEY ("shareholderId") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_kiosk_sessions" ADD CONSTRAINT "meeting_kiosk_sessions_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

