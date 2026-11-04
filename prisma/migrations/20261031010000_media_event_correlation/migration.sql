-- A correlation trace may cover several jobs, lifecycle events and subscribers.
-- Keep canonical row IDs and the existing event/endpoint delivery uniqueness.
CREATE INDEX "MediaProcessingJob_traceId_idx" ON "MediaProcessingJob"("traceId");
CREATE INDEX "DomainEvent_traceId_idx" ON "DomainEvent"("traceId");
CREATE INDEX "WebhookDelivery_traceId_idx" ON "WebhookDelivery"("traceId");
DROP INDEX "MediaProcessingJob_traceId_key";
DROP INDEX "DomainEvent_traceId_key";
DROP INDEX "WebhookDelivery_traceId_key";

-- Nullable for existing events. New media lifecycle events use a stable job+phase
-- key so delivery retries do not create another domain event/outbox record.
ALTER TABLE "DomainEvent" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "DomainEvent_idempotencyKey_key" ON "DomainEvent"("idempotencyKey");
