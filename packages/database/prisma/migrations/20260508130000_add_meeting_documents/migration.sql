-- AlterTable
ALTER TABLE "meeting_attendances" ADD COLUMN     "documentsDownloadedAt" TIMESTAMP(3),
ADD COLUMN     "documentsEmailError" TEXT,
ADD COLUMN     "documentsEmailOpenedAt" TIMESTAMP(3),
ADD COLUMN     "documentsEmailSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "documentsEmailSentAt" TIMESTAMP(3),
ADD COLUMN     "documentsIntro" TEXT,
ADD COLUMN     "documentsSubject" TEXT;

-- CreateTable
CREATE TABLE "meeting_documents" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL,

    CONSTRAINT "meeting_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meeting_documents_meetingId_order_idx" ON "meeting_documents"("meetingId", "order");

-- AddForeignKey
ALTER TABLE "meeting_documents" ADD CONSTRAINT "meeting_documents_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
