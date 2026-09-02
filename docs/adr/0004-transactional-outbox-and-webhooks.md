# ADR 0004: Use a Transactional Outbox for Operational Webhooks

- Status: Accepted
- Date: 2026-08-14

## Context

Moving an event to `READY` or `LIVE` changes business state and must notify downstream systems. Publishing directly from the request handler can lose the notification after a database commit, while publishing first can notify consumers about a change that later rolls back.

## Decision

Write the event mutation, domain event, outbox entry and audit record inside one PostgreSQL transaction. A BullMQ worker claims pending outbox records and creates one delivery per subscribed endpoint. Deliveries use a stable domain-event ID, HMAC-SHA256 signatures, bounded exponential retry and persisted attempt evidence.

OpsPilot v1.1 only creates a server-controlled local demo endpoint. It does not accept arbitrary customer URLs.

## Consequences

- A committed transition cannot silently lose its integration intent.
- Delivery is at least once, so receivers must deduplicate by the event ID.
- Operators can inspect status, attempts, response codes and trace IDs.
- Supporting arbitrary URLs later requires SSRF protection, secret rotation and stronger egress controls.
