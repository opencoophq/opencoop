-- ============================================================================
-- Part A: base messaging schema (idempotent)
--
-- conversations / conversation_participants / messages / message_attachments
-- and the ConversationType enum were created out of band on prod/acc (not via
-- a tracked migration) but do not exist in freshly-provisioned dev databases.
-- Every statement below is written so it is a no-op where the object already
-- exists, so this migration behaves the same on both.
-- ============================================================================

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ConversationType" AS ENUM ('BROADCAST', 'DIRECT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "conversations" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "conversation_participants" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "shareholderId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "message_attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "filePath" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "shareholderDocumentId" TEXT,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_coopId_idx" ON "conversations"("coopId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_createdById_idx" ON "conversations"("createdById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversation_participants_shareholderId_idx" ON "conversation_participants"("shareholderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_participants_conversationId_shareholderId_key" ON "conversation_participants"("conversationId", "shareholderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "messages_conversationId_idx" ON "messages"("conversationId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_shareholderId_fkey" FOREIGN KEY ("shareholderId") REFERENCES "shareholders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Part B: drafts, scheduling and audience (this task)
-- ============================================================================

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENT');

-- CreateEnum
CREATE TYPE "AudienceType" AS ENUM ('ALL', 'PROJECT', 'SELECTED');

-- CreateEnum
CREATE TYPE "MessageFormat" AS ENUM ('TEXT', 'HTML');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "audienceProjectId" TEXT,
ADD COLUMN     "audienceShareholderIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audienceType" "AudienceType" NOT NULL DEFAULT 'ALL',
ADD COLUMN     "createdByApiKeyId" TEXT,
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "sendAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "status" "ConversationStatus" NOT NULL DEFAULT 'SENT';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "format" "MessageFormat" NOT NULL DEFAULT 'TEXT';

-- CreateIndex
CREATE INDEX "conversations_coopId_status_idx" ON "conversations"("coopId", "status");

-- CreateIndex
CREATE INDEX "conversations_status_scheduledAt_idx" ON "conversations"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_audienceProjectId_fkey" FOREIGN KEY ("audienceProjectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_createdByApiKeyId_fkey" FOREIGN KEY ("createdByApiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: everything that exists today was sent the moment it was created.
UPDATE "conversations"
SET "status" = 'SENT', "sentAt" = "createdAt"
WHERE "status" = 'SENT' AND "sentAt" IS NULL;

-- Broadcasts addressed everyone; direct conversations addressed their single participant.
UPDATE "conversations" SET "audienceType" = 'ALL' WHERE "type" = 'BROADCAST';

UPDATE "conversations" c
SET "audienceType" = 'SELECTED',
    "audienceShareholderIds" = ARRAY(
      SELECT p."shareholderId" FROM "conversation_participants" p WHERE p."conversationId" = c."id"
    )
WHERE c."type" = 'DIRECT';
