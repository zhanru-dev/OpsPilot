ALTER TYPE "MediaUploadStatus" ADD VALUE 'FINALIZING';
ALTER TYPE "MediaUploadStatus" ADD VALUE 'FAILED';
ALTER TABLE "MediaAsset" ADD COLUMN "sourceSha256" TEXT,
 ADD COLUMN "cleanupPending" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "cleanupAfter" TIMESTAMP(3), ADD COLUMN "cleanupAttemptedAt" TIMESTAMP(3);
ALTER TABLE "MediaUpload" ADD COLUMN "ownerUserId" TEXT,
 ADD COLUMN "clientOperationId" TEXT, ADD COLUMN "manifest" JSONB,
 ADD COLUMN "multipartId" TEXT, ADD COLUMN "finalizingAt" TIMESTAMP(3),
 ADD COLUMN "lastGrantExpiresAt" TIMESTAMP(3), ADD COLUMN "failureReason" TEXT,
 ADD CONSTRAINT "MediaUpload_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "MediaUpload_manifest_identity_check" CHECK ("manifest" IS NULL OR ("ownerUserId" IS NOT NULL AND "clientOperationId" IS NOT NULL AND "expectedSizeBytes" BETWEEN 1 AND 104857600));
CREATE UNIQUE INDEX "MediaUpload_workspaceId_ownerUserId_clientOperationId_key" ON "MediaUpload"("workspaceId", "ownerUserId", "clientOperationId");
ALTER TABLE "MediaProcessingJob" ADD COLUMN "uploadId" TEXT, ADD COLUMN "executionVersion" INTEGER NOT NULL DEFAULT 0,
 ADD CONSTRAINT "MediaProcessingJob_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "MediaUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "MediaProcessingJob_uploadId_key" ON "MediaProcessingJob"("uploadId");
CREATE TABLE "MediaUploadPart" (
 "uploadId" TEXT NOT NULL, "number" INTEGER NOT NULL, "sizeBytes" INTEGER NOT NULL,
 "sha256" TEXT NOT NULL, "etag" TEXT NOT NULL,
 CONSTRAINT "MediaUploadPart_pkey" PRIMARY KEY ("uploadId", "number"),
 CONSTRAINT "MediaUploadPart_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "MediaUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "MediaUploadPart_bounds_check" CHECK ("number" BETWEEN 1 AND 20 AND "sizeBytes" BETWEEN 1 AND 5242880 AND "sha256" ~ '^[a-f0-9]{64}$')
);
