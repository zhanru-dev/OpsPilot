-- CreateEnum
CREATE TYPE "RecommendationRunProvider" AS ENUM ('DETERMINISTIC', 'OPENAI');

-- CreateEnum
CREATE TYPE "RecommendationRunStatus" AS ENUM ('APPLIED', 'AWAITING_CONFIRMATION', 'FALLBACK', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalyticsGranularity" AS ENUM ('DAILY');

-- CreateEnum
CREATE TYPE "ErrorReportSource" AS ENUM ('WEB', 'API', 'WORKER');

-- CreateEnum
CREATE TYPE "ErrorReportSeverity" AS ENUM ('WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ErrorReportStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "RecommendationRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "provider" "RecommendationRunProvider" NOT NULL,
    "status" "RecommendationRunStatus" NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT NOT NULL DEFAULT '1.2',
    "inputSnapshot" JSONB NOT NULL,
    "output" JSONB,
    "fallbackReason" TEXT,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "granularity" "AnalyticsGranularity" NOT NULL DEFAULT 'DAILY',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "eventsTotal" INTEGER NOT NULL DEFAULT 0,
    "readyEvents" INTEGER NOT NULL DEFAULT 0,
    "atRiskEvents" INTEGER NOT NULL DEFAULT 0,
    "blockedEvents" INTEGER NOT NULL DEFAULT 0,
    "averageReadiness" INTEGER NOT NULL DEFAULT 0,
    "mediaProcessed" INTEGER NOT NULL DEFAULT 0,
    "mediaFailed" INTEGER NOT NULL DEFAULT 0,
    "webhookSucceeded" INTEGER NOT NULL DEFAULT 0,
    "webhookFailed" INTEGER NOT NULL DEFAULT 0,
    "recommendationsOpened" INTEGER NOT NULL DEFAULT 0,
    "recommendationsResolved" INTEGER NOT NULL DEFAULT 0,
    "webErrors" INTEGER NOT NULL DEFAULT 0,
    "apiErrors" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "updatedById" TEXT,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorReport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "source" "ErrorReportSource" NOT NULL,
    "severity" "ErrorReportSeverity" NOT NULL DEFAULT 'ERROR',
    "status" "ErrorReportStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "path" TEXT,
    "fingerprint" TEXT NOT NULL,
    "traceId" TEXT,
    "metadata" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrorReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecommendationRun_workspaceId_createdAt_idx" ON "RecommendationRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendationRun_eventId_status_createdAt_idx" ON "RecommendationRun"("eventId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendationRun_requestedById_createdAt_idx" ON "RecommendationRun"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_workspaceId_periodStart_idx" ON "AnalyticsSnapshot"("workspaceId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSnapshot_workspaceId_granularity_periodStart_key" ON "AnalyticsSnapshot"("workspaceId", "granularity", "periodStart");

-- CreateIndex
CREATE INDEX "FeatureFlag_workspaceId_enabled_idx" ON "FeatureFlag"("workspaceId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_workspaceId_key_key" ON "FeatureFlag"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "ErrorReport_workspaceId_status_createdAt_idx" ON "ErrorReport"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorReport_fingerprint_createdAt_idx" ON "ErrorReport"("fingerprint", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorReport_traceId_idx" ON "ErrorReport"("traceId");

-- AddForeignKey
ALTER TABLE "RecommendationRun" ADD CONSTRAINT "RecommendationRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationRun" ADD CONSTRAINT "RecommendationRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StreamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationRun" ADD CONSTRAINT "RecommendationRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationRun" ADD CONSTRAINT "RecommendationRun_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorReport" ADD CONSTRAINT "ErrorReport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorReport" ADD CONSTRAINT "ErrorReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
