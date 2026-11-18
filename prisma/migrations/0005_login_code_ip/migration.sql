-- AlterTable
ALTER TABLE "LoginCode" ADD COLUMN     "ipHash" TEXT;

-- CreateIndex
CREATE INDEX "LoginCode_ipHash_createdAt_idx" ON "LoginCode"("ipHash", "createdAt");

