-- CreateTable
CREATE TABLE "EventInvitation" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "mailRequestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mailSentAt" TIMESTAMP(3),
    "mailAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "mailAvailableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mailVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventInvitation_eventId_createdAt_id_idx" ON "EventInvitation"("eventId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "EventInvitation_mailAvailableAt_idx" ON "EventInvitation"("mailAvailableAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventInvitation_eventId_email_key" ON "EventInvitation"("eventId", "email");

-- AddForeignKey
ALTER TABLE "EventInvitation" ADD CONSTRAINT "EventInvitation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StreamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
