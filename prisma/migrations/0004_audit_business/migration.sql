-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "businessId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_businessId_createdAt_idx" ON "AuditLog"("businessId", "createdAt");

