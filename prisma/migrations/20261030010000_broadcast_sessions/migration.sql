-- CreateEnum
CREATE TYPE "BroadcastState" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "BroadcastAvailability" AS ENUM ('WAITING', 'LIVE', 'INTERRUPTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BroadcastGrantKind" AS ENUM ('PUBLISH', 'PLAYBACK');

-- AlterTable
ALTER TABLE "StreamEvent" ADD COLUMN     "broadcastRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BroadcastSession" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "clientOperationId" TEXT NOT NULL,
    "state" "BroadcastState" NOT NULL DEFAULT 'ACTIVE',
    "availability" "BroadcastAvailability" NOT NULL DEFAULT 'WAITING',
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstLiveAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "sourceId" TEXT,
    "cleanupPending" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BroadcastSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastGrant" (
    "hash" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "BroadcastGrantKind" NOT NULL,
    "principal" JSONB NOT NULL,
    "principalKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastGrant_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "BroadcastPublisher" (
    "id" TEXT NOT NULL,
    "grantHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastPublisher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BroadcastSession_eventId_createdAt_id_idx" ON "BroadcastSession"("eventId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "BroadcastSession_state_cleanupPending_checkedAt_idx" ON "BroadcastSession"("state", "cleanupPending", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastSession_eventId_creatorId_clientOperationId_key" ON "BroadcastSession"("eventId", "creatorId", "clientOperationId");

-- CreateIndex
CREATE INDEX "BroadcastGrant_sessionId_kind_principalKey_idx" ON "BroadcastGrant"("sessionId", "kind", "principalKey");

-- CreateIndex
CREATE INDEX "BroadcastGrant_expiresAt_idx" ON "BroadcastGrant"("expiresAt");

-- CreateIndex
CREATE INDEX "BroadcastPublisher_grantHash_idx" ON "BroadcastPublisher"("grantHash");

-- AddForeignKey
ALTER TABLE "BroadcastSession" ADD CONSTRAINT "BroadcastSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StreamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastSession" ADD CONSTRAINT "BroadcastSession_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastGrant" ADD CONSTRAINT "BroadcastGrant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BroadcastSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastPublisher" ADD CONSTRAINT "BroadcastPublisher_grantHash_fkey" FOREIGN KEY ("grantHash") REFERENCES "BroadcastGrant"("hash") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lifecycle/credential constraints supplement Prisma's additive relations.
CREATE UNIQUE INDEX "BroadcastSession_one_active_per_event" ON "BroadcastSession" ("eventId") WHERE "state" = 'ACTIVE';
ALTER TABLE "StreamEvent" ADD CONSTRAINT "broadcast_revision_nonnegative" CHECK ("broadcastRevision" >= 0);
ALTER TABLE "BroadcastSession" ADD CONSTRAINT "broadcast_valid_lifecycle" CHECK (("state" = 'ACTIVE' AND "endedAt" IS NULL) OR ("state" = 'ENDED' AND "endedAt" IS NOT NULL));
ALTER TABLE "BroadcastSession" ADD CONSTRAINT "broadcast_revision_positive" CHECK ("revision" > 0);
ALTER TABLE "BroadcastGrant" ADD CONSTRAINT "broadcast_grant_hash" CHECK ("hash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "BroadcastGrant" ADD CONSTRAINT "broadcast_grant_expiry" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "BroadcastGrant" ADD CONSTRAINT "broadcast_grant_principal" CHECK (jsonb_typeof("principal") = 'object' AND "principal"->>'kind' IN ('staff', 'attendee'));
