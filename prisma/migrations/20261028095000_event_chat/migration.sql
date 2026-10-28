-- CreateEnum
CREATE TYPE "ChatActorKind" AS ENUM ('STAFF', 'ATTENDEE');

-- CreateEnum
CREATE TYPE "ChatEventKind" AS ENUM ('CREATED', 'DELETED');

-- AlterTable
ALTER TABLE "StreamEvent" ADD COLUMN     "chatSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EventChatMessage" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "authorKind" "ChatActorKind" NOT NULL,
    "authorKey" TEXT NOT NULL,
    "staffUserId" TEXT,
    "attendeeRegistrationId" TEXT,
    "authorName" TEXT NOT NULL,
    "clientMessageId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "text" TEXT,
    "createdSequence" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "EventChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventChatEvent" (
    "eventId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind" "ChatEventKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventChatEvent_pkey" PRIMARY KEY ("eventId","sequence")
);

-- CreateIndex
CREATE INDEX "EventChatMessage_staffUserId_idx" ON "EventChatMessage"("staffUserId");

-- CreateIndex
CREATE INDEX "EventChatMessage_attendeeRegistrationId_eventId_idx" ON "EventChatMessage"("attendeeRegistrationId", "eventId");

-- CreateIndex
CREATE INDEX "EventChatMessage_deletedByUserId_idx" ON "EventChatMessage"("deletedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "EventChatMessage_id_eventId_key" ON "EventChatMessage"("id", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventChatMessage_eventId_authorKey_clientMessageId_key" ON "EventChatMessage"("eventId", "authorKey", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "EventChatMessage_eventId_createdSequence_key" ON "EventChatMessage"("eventId", "createdSequence");

-- CreateIndex
CREATE INDEX "EventChatEvent_messageId_eventId_idx" ON "EventChatEvent"("messageId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_id_eventId_key" ON "EventRegistration"("id", "eventId");

-- AddForeignKey
ALTER TABLE "EventChatMessage" ADD CONSTRAINT "EventChatMessage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StreamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventChatMessage" ADD CONSTRAINT "EventChatMessage_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventChatMessage" ADD CONSTRAINT "EventChatMessage_attendeeRegistrationId_eventId_fkey" FOREIGN KEY ("attendeeRegistrationId", "eventId") REFERENCES "EventRegistration"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventChatMessage" ADD CONSTRAINT "EventChatMessage_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventChatEvent" ADD CONSTRAINT "EventChatEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StreamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventChatEvent" ADD CONSTRAINT "EventChatEvent_messageId_eventId_fkey" FOREIGN KEY ("messageId", "eventId") REFERENCES "EventChatMessage"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Polymorphic actors remain distinct and attendee messages cannot cross events.
ALTER TABLE "EventChatMessage" ADD CONSTRAINT "EventChatMessage_actor_check" CHECK (
  ("authorKind" = 'STAFF' AND "staffUserId" IS NOT NULL AND "attendeeRegistrationId" IS NULL
    AND "authorKey" = 'staff:' || "staffUserId") OR
  ("authorKind" = 'ATTENDEE' AND "attendeeRegistrationId" IS NOT NULL AND "staffUserId" IS NULL
    AND "authorKey" = 'attendee:' || "attendeeRegistrationId")
);
ALTER TABLE "EventChatMessage" ADD CONSTRAINT "EventChatMessage_content_check" CHECK (
  "createdSequence" > 0 AND "version" >= "createdSequence" AND
  "requestHash" ~ '^[a-f0-9]{64}$' AND
  (("deletedAt" IS NULL AND "text" IS NOT NULL AND length("text") BETWEEN 1 AND 2000)
   OR ("deletedAt" IS NOT NULL AND "text" IS NULL))
);
ALTER TABLE "EventChatEvent" ADD CONSTRAINT "EventChatEvent_sequence_check" CHECK ("sequence" > 0);
ALTER TABLE "StreamEvent" ADD CONSTRAINT "StreamEvent_chatSequence_check" CHECK ("chatSequence" >= 0);
