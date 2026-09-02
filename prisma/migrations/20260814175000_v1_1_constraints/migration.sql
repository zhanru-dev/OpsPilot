ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_processingProgress_check"
  CHECK ("processingProgress" BETWEEN 0 AND 100);

ALTER TABLE "MediaUpload"
  ADD CONSTRAINT "MediaUpload_expectedSizeBytes_check"
  CHECK ("expectedSizeBytes" > 0),
  ADD CONSTRAINT "MediaUpload_expiry_check"
  CHECK ("expiresAt" > "createdAt"),
  ADD CONSTRAINT "MediaUpload_completion_check"
  CHECK ("completedAt" IS NULL OR "completedAt" >= "createdAt");

ALTER TABLE "MediaProcessingJob"
  ADD CONSTRAINT "MediaProcessingJob_attemptCount_check"
  CHECK ("attemptCount" >= 0),
  ADD CONSTRAINT "MediaProcessingJob_maxAttempts_check"
  CHECK ("maxAttempts" BETWEEN 1 AND 5),
  ADD CONSTRAINT "MediaProcessingJob_progress_check"
  CHECK ("progress" BETWEEN 0 AND 100),
  ADD CONSTRAINT "MediaProcessingJob_startedAt_check"
  CHECK ("startedAt" IS NULL OR "startedAt" >= "queuedAt"),
  ADD CONSTRAINT "MediaProcessingJob_finishedAt_check"
  CHECK ("finishedAt" IS NULL OR "startedAt" IS NULL OR "finishedAt" >= "startedAt");

ALTER TABLE "MediaProcessingAttempt"
  ADD CONSTRAINT "MediaProcessingAttempt_number_check"
  CHECK ("attemptNumber" > 0),
  ADD CONSTRAINT "MediaProcessingAttempt_finishedAt_check"
  CHECK ("finishedAt" IS NULL OR "finishedAt" >= "startedAt");

ALTER TABLE "MediaVariant"
  ADD CONSTRAINT "MediaVariant_sizeBytes_check"
  CHECK ("sizeBytes" > 0),
  ADD CONSTRAINT "MediaVariant_durationSeconds_check"
  CHECK ("durationSeconds" IS NULL OR "durationSeconds" > 0),
  ADD CONSTRAINT "MediaVariant_width_check"
  CHECK ("width" IS NULL OR "width" > 0),
  ADD CONSTRAINT "MediaVariant_height_check"
  CHECK ("height" IS NULL OR "height" > 0);

ALTER TABLE "OutboxEvent"
  ADD CONSTRAINT "OutboxEvent_attemptCount_check"
  CHECK ("attemptCount" >= 0);

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_attemptCount_check"
  CHECK ("attemptCount" >= 0);

ALTER TABLE "WebhookDeliveryAttempt"
  ADD CONSTRAINT "WebhookDeliveryAttempt_number_check"
  CHECK ("attemptNumber" > 0),
  ADD CONSTRAINT "WebhookDeliveryAttempt_durationMs_check"
  CHECK ("durationMs" >= 0);
