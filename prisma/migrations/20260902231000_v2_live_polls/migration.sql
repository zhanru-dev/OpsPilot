-- CreateEnum
CREATE TYPE "LivePollStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "LivePoll" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdById" TEXT,
    "question" TEXT NOT NULL,
    "status" "LivePollStatus" NOT NULL DEFAULT 'DRAFT',
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LivePoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivePollOption" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LivePollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivePollResponse" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT,
    "voterKeyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LivePollResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LivePoll_sessionId_status_createdAt_idx" ON "LivePoll"("sessionId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LivePollOption_pollId_sortOrder_key" ON "LivePollOption"("pollId", "sortOrder");

-- CreateIndex
CREATE INDEX "LivePollResponse_optionId_idx" ON "LivePollResponse"("optionId");

-- CreateIndex
CREATE INDEX "LivePollResponse_userId_idx" ON "LivePollResponse"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LivePollResponse_pollId_voterKeyHash_key" ON "LivePollResponse"("pollId", "voterKeyHash");

-- AddForeignKey
ALTER TABLE "LivePoll" ADD CONSTRAINT "LivePoll_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivePoll" ADD CONSTRAINT "LivePoll_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivePollOption" ADD CONSTRAINT "LivePollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "LivePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivePollResponse" ADD CONSTRAINT "LivePollResponse_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "LivePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivePollResponse" ADD CONSTRAINT "LivePollResponse_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "LivePollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivePollResponse" ADD CONSTRAINT "LivePollResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
