-- CreateEnum
CREATE TYPE "ApiKeyScope" AS ENUM ('READ_ONLY', 'READ_WRITE');

-- AlterTable
ALTER TABLE "api_keys"
ADD COLUMN "scope" "ApiKeyScope" NOT NULL DEFAULT 'READ_ONLY';
