-- CreateEnum
CREATE TYPE "MediaUploadStatus" AS ENUM ('PENDING', 'UPLOADED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MediaProcessingJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaProcessingAttemptStatus" AS ENUM ('PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaVariantKind" AS ENUM ('PREVIEW', 'THUMBNAIL');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookEndpointStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERING', 'RETRYING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookAttemptStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "originalObjectKey" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "processingProgress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceContentType" TEXT,
ADD COLUMN     "uploadedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MediaUpload" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "expectedSizeBytes" INTEGER NOT NULL,
    "status" "MediaUploadStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaProcessingJob" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "status" "MediaProcessingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "profileVersion" TEXT NOT NULL DEFAULT '1.0',
    "bullJobId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaProcessingAttempt" (
    "id" TEXT NOT NULL,
    "processingJobId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "MediaProcessingAttemptStatus" NOT NULL DEFAULT 'PROCESSING',
    "failureCode" TEXT,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "MediaProcessingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaVariant" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "kind" "MediaVariantKind" NOT NULL,
    "profileVersion" TEXT NOT NULL DEFAULT '1.0',
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSeconds" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "traceId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "domainEventId" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "status" "WebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "domainEventId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "responseStatus" INTEGER,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "traceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "WebhookAttemptStatus" NOT NULL,
    "responseStatus" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaUpload_objectKey_key" ON "MediaUpload"("objectKey");

-- CreateIndex
CREATE INDEX "MediaUpload_workspaceId_status_expiresAt_idx" ON "MediaUpload"("workspaceId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "MediaUpload_mediaId_createdAt_idx" ON "MediaUpload"("mediaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaProcessingJob_bullJobId_key" ON "MediaProcessingJob"("bullJobId");

-- CreateIndex
CREATE INDEX "MediaProcessingJob_mediaId_createdAt_idx" ON "MediaProcessingJob"("mediaId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaProcessingJob_status_queuedAt_idx" ON "MediaProcessingJob"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "MediaProcessingAttempt_status_startedAt_idx" ON "MediaProcessingAttempt"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaProcessingAttempt_processingJobId_attemptNumber_key" ON "MediaProcessingAttempt"("processingJobId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MediaVariant_objectKey_key" ON "MediaVariant"("objectKey");

-- CreateIndex
CREATE INDEX "MediaVariant_mediaId_createdAt_idx" ON "MediaVariant"("mediaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaVariant_mediaId_kind_profileVersion_key" ON "MediaVariant"("mediaId", "kind", "profileVersion");

-- CreateIndex
CREATE UNIQUE INDEX "DomainEvent_traceId_key" ON "DomainEvent"("traceId");

-- CreateIndex
CREATE INDEX "DomainEvent_workspaceId_type_occurredAt_idx" ON "DomainEvent"("workspaceId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_aggregateType_aggregateId_occurredAt_idx" ON "DomainEvent"("aggregateType", "aggregateId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_domainEventId_key" ON "OutboxEvent"("domainEventId");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_workspaceId_status_idx" ON "WebhookEndpoint"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_workspaceId_name_key" ON "WebhookEndpoint"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "WebhookSubscription_eventType_idx" ON "WebhookSubscription"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookSubscription_endpointId_eventType_key" ON "WebhookSubscription"("endpointId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_traceId_key" ON "WebhookDelivery"("traceId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_workspaceId_status_createdAt_idx" ON "WebhookDelivery"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_domainEventId_endpointId_key" ON "WebhookDelivery"("domainEventId", "endpointId");

-- CreateIndex
CREATE INDEX "WebhookDeliveryAttempt_status_createdAt_idx" ON "WebhookDeliveryAttempt"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDeliveryAttempt_deliveryId_attemptNumber_key" ON "WebhookDeliveryAttempt"("deliveryId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "MediaUpload" ADD CONSTRAINT "MediaUpload_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaUpload" ADD CONSTRAINT "MediaUpload_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaProcessingJob" ADD CONSTRAINT "MediaProcessingJob_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaProcessingAttempt" ADD CONSTRAINT "MediaProcessingAttempt_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "MediaProcessingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaVariant" ADD CONSTRAINT "MediaVariant_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_domainEventId_fkey" FOREIGN KEY ("domainEventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_domainEventId_fkey" FOREIGN KEY ("domainEventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDeliveryAttempt" ADD CONSTRAINT "WebhookDeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "WebhookDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
