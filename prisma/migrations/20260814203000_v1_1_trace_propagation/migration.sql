-- Add a durable trace identifier so recovered queue jobs keep their original correlation context.
ALTER TABLE "MediaProcessingJob" ADD COLUMN "traceId" TEXT;

UPDATE "MediaProcessingJob"
SET "traceId" = gen_random_uuid()::text
WHERE "traceId" IS NULL;

ALTER TABLE "MediaProcessingJob" ALTER COLUMN "traceId" SET NOT NULL;

CREATE UNIQUE INDEX "MediaProcessingJob_traceId_key"
ON "MediaProcessingJob"("traceId");
