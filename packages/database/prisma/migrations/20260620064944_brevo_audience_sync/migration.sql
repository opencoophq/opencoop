-- AlterTable
ALTER TABLE "coops" ADD COLUMN     "brevoApiKey" TEXT,
ADD COLUMN     "brevoLastSyncAt" TIMESTAMP(3),
ADD COLUMN     "brevoLastSyncStatus" TEXT,
ADD COLUMN     "brevoMembersListId" TEXT,
ADD COLUMN     "brevoResignedListId" TEXT,
ADD COLUMN     "emailAudienceProvider" TEXT;

-- CreateTable
CREATE TABLE "BrevoSyncRun" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "added" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "moved" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,

    CONSTRAINT "BrevoSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrevoSyncRun_coopId_startedAt_idx" ON "BrevoSyncRun"("coopId", "startedAt");

-- AddForeignKey
ALTER TABLE "BrevoSyncRun" ADD CONSTRAINT "BrevoSyncRun_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

