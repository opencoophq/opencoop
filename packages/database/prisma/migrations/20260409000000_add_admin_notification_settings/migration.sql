-- CreateEnum
CREATE TYPE "AdminNotificationFrequency" AS ENUM ('IMMEDIATE', 'DAILY', 'WEEKLY');

-- CreateTable
CREATE TABLE "coop_admin_notification_settings" (
    "id" TEXT NOT NULL,
    "coopAdminId" TEXT NOT NULL,
    "frequency" "AdminNotificationFrequency" NOT NULL DEFAULT 'IMMEDIATE',
    "notifyOnNewShareholder" BOOLEAN NOT NULL DEFAULT false,
    "notifyOnSharePurchase" BOOLEAN NOT NULL DEFAULT false,
    "notifyOnShareSell" BOOLEAN NOT NULL DEFAULT false,
    "notifyOnPaymentReceived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coop_admin_notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coop_admin_notification_settings_coopAdminId_key" ON "coop_admin_notification_settings"("coopAdminId");

-- AddForeignKey
ALTER TABLE "coop_admin_notification_settings" ADD CONSTRAINT "coop_admin_notification_settings_coopAdminId_fkey" FOREIGN KEY ("coopAdminId") REFERENCES "coop_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
