-- CreateEnum
CREATE TYPE "TopicStatus" AS ENUM ('PENDING', 'APPROVED');

-- AlterTable
ALTER TABLE "StreamEvent" ADD COLUMN     "topicAudiencePublishing" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "topicAudienceReplies" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "topicModerationRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "topicSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "topicSettingsRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EventTopic" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "authorKind" "ChatActorKind" NOT NULL,
    "authorKey" TEXT NOT NULL,
    "staffUserId" TEXT,
    "attendeeRegistrationId" TEXT,
    "authorName" TEXT NOT NULL,
    "clientOperationId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "text" TEXT,
    "status" "TopicStatus" NOT NULL DEFAULT 'PENDING',
    "wasPublic" BOOLEAN NOT NULL DEFAULT false,
    "pinSlot" INTEGER,
    "createdSequence" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "moderatedByUserId" TEXT,
    "moderatedAt" TIMESTAMP(3),

    CONSTRAINT "EventTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTopicReply" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "authorKind" "ChatActorKind" NOT NULL,
    "authorKey" TEXT NOT NULL,
    "staffUserId" TEXT,
    "attendeeRegistrationId" TEXT,
    "authorName" TEXT NOT NULL,
    "clientOperationId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "text" TEXT,
    "createdSequence" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "EventTopicReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventTopic_eventId_status_createdSequence_idx" ON "EventTopic"("eventId", "status", "createdSequence");

-- CreateIndex
CREATE INDEX "EventTopic_attendeeRegistrationId_eventId_idx" ON "EventTopic"("attendeeRegistrationId", "eventId");

-- CreateIndex
CREATE INDEX "EventTopic_staffUserId_idx" ON "EventTopic"("staffUserId");

-- CreateIndex
CREATE INDEX "EventTopic_moderatedByUserId_idx" ON "EventTopic"("moderatedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "EventTopic_id_eventId_key" ON "EventTopic"("id", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventTopic_eventId_authorKey_clientOperationId_key" ON "EventTopic"("eventId", "authorKey", "clientOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "EventTopic_eventId_pinSlot_key" ON "EventTopic"("eventId", "pinSlot");

-- CreateIndex
CREATE UNIQUE INDEX "EventTopic_eventId_createdSequence_key" ON "EventTopic"("eventId", "createdSequence");

-- CreateIndex
CREATE INDEX "EventTopicReply_topicId_eventId_createdSequence_idx" ON "EventTopicReply"("topicId", "eventId", "createdSequence");

-- CreateIndex
CREATE INDEX "EventTopicReply_attendeeRegistrationId_eventId_idx" ON "EventTopicReply"("attendeeRegistrationId", "eventId");

-- CreateIndex
CREATE INDEX "EventTopicReply_staffUserId_idx" ON "EventTopicReply"("staffUserId");

-- CreateIndex
CREATE INDEX "EventTopicReply_deletedByUserId_idx" ON "EventTopicReply"("deletedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "EventTopicReply_eventId_authorKey_clientOperationId_key" ON "EventTopicReply"("eventId", "authorKey", "clientOperationId");

-- AddForeignKey
ALTER TABLE "EventTopic" ADD CONSTRAINT "EventTopic_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StreamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTopic" ADD CONSTRAINT "EventTopic_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTopic" ADD CONSTRAINT "EventTopic_attendeeRegistrationId_eventId_fkey" FOREIGN KEY ("attendeeRegistrationId", "eventId") REFERENCES "EventRegistration"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTopic" ADD CONSTRAINT "EventTopic_moderatedByUserId_fkey" FOREIGN KEY ("moderatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTopicReply" ADD CONSTRAINT "EventTopicReply_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StreamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTopicReply" ADD CONSTRAINT "EventTopicReply_topicId_eventId_fkey" FOREIGN KEY ("topicId", "eventId") REFERENCES "EventTopic"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTopicReply" ADD CONSTRAINT "EventTopicReply_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTopicReply" ADD CONSTRAINT "EventTopicReply_attendeeRegistrationId_eventId_fkey" FOREIGN KEY ("attendeeRegistrationId", "eventId") REFERENCES "EventRegistration"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTopicReply" ADD CONSTRAINT "EventTopicReply_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "EventTopic" ADD CONSTRAINT "EventTopic_actor_check" CHECK (
 ("authorKind" = 'STAFF' AND "staffUserId" IS NOT NULL AND "attendeeRegistrationId" IS NULL AND "authorKey" = 'staff:' || "staffUserId") OR
 ("authorKind" = 'ATTENDEE' AND "staffUserId" IS NULL AND "attendeeRegistrationId" IS NOT NULL AND "authorKey" = 'attendee:' || "attendeeRegistrationId")
);
ALTER TABLE "EventTopic" ADD CONSTRAINT "EventTopic_content_check" CHECK (
 "createdSequence" > 0 AND "version" >= "createdSequence" AND "requestHash" ~ '^[a-f0-9]{64}$' AND
 (("deletedAt" IS NULL AND "text" IS NOT NULL AND length(btrim("text")) BETWEEN 1 AND 2000)
 OR ("deletedAt" IS NOT NULL AND "text" IS NULL))
);

ALTER TABLE "EventTopicReply" ADD CONSTRAINT "EventTopicReply_actor_check" CHECK (
 ("authorKind" = 'STAFF' AND "staffUserId" IS NOT NULL AND "attendeeRegistrationId" IS NULL AND "authorKey" = 'staff:' || "staffUserId") OR
 ("authorKind" = 'ATTENDEE' AND "staffUserId" IS NULL AND "attendeeRegistrationId" IS NOT NULL AND "authorKey" = 'attendee:' || "attendeeRegistrationId")
);
ALTER TABLE "EventTopicReply" ADD CONSTRAINT "EventTopicReply_content_check" CHECK (
 "createdSequence" > 0 AND "version" >= "createdSequence" AND "requestHash" ~ '^[a-f0-9]{64}$' AND
 (("deletedAt" IS NULL AND "text" IS NOT NULL AND length(btrim("text")) BETWEEN 1 AND 2000)
 OR ("deletedAt" IS NOT NULL AND "text" IS NULL))
);

ALTER TABLE "EventTopic" ADD CONSTRAINT "EventTopic_pin_check" CHECK (
 "pinSlot" IS NULL OR ("pinSlot" BETWEEN 1 AND 7 AND "status" = 'APPROVED' AND "deletedAt" IS NULL)
);
ALTER TABLE "EventTopic" ADD CONSTRAINT "EventTopic_public_check" CHECK ("status" <> 'APPROVED' OR "wasPublic");
ALTER TABLE "StreamEvent" ADD CONSTRAINT "StreamEvent_topic_sequence_check" CHECK ("topicSequence" >= 0 AND "topicSettingsRevision" >= 0 AND "topicSettingsRevision" <= "topicSequence");
