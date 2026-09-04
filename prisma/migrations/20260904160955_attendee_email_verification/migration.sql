-- CreateTable
CREATE TABLE "AttendeeVerification" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenEncrypted" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendeeVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendeeSession" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendeeSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendeeVerification_tokenHash_key" ON "AttendeeVerification"("tokenHash");

-- CreateIndex
CREATE INDEX "AttendeeVerification_registrationId_createdAt_idx" ON "AttendeeVerification"("registrationId", "createdAt");

-- CreateIndex
CREATE INDEX "AttendeeVerification_availableAt_expiresAt_idx" ON "AttendeeVerification"("availableAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendeeSession_tokenHash_key" ON "AttendeeSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AttendeeSession_registrationId_idx" ON "AttendeeSession"("registrationId");

-- CreateIndex
CREATE INDEX "AttendeeSession_expiresAt_idx" ON "AttendeeSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "AttendeeVerification" ADD CONSTRAINT "AttendeeVerification_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendeeSession" ADD CONSTRAINT "AttendeeSession_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
