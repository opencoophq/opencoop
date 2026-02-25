-- CreateTable
CREATE TABLE "migration_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "coopName" TEXT NOT NULL,
    "estimatedShareholders" TEXT,
    "currentSystem" TEXT,
    "message" TEXT NOT NULL,
    "locale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_requests_pkey" PRIMARY KEY ("id")
);
