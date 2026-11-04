# Topics integration plan and contracts

2026-10-29, before implementation. Destination clean at b09f5a2; source Mudu 7bd9a2f
read-only (two pre-existing untracked streaming audit artifacts). Approved task:
[updated prompt](topics-integration-task.md). Chat P1 was repaired in 1ac03b4; the original
FAIL report remains historical. No unresolved in-scope critical issue is known at this baseline.

## Reuse and chosen design

Read Mudu Topics service, normalized state, original technical review, upgrade report and
reconnect remediation. Reuse independently authored algorithms/behaviour, not captured source
or Pages Router screens. Mudu uses content-free invalidations + snapshots; retain that design.
OpsPilot Polls/Live Operations/SSE are separate and remain unchanged except UI composition.

Extract current principal/session/membership/admission validation into EventIdentityService;
ChatAuthorizationService remains a compatible capability wrapper. TopicAuthorization is
implemented beside the Topics service using this same boundary, not another RBAC store.

One existing Socket.IO /chat Gateway/server, one Redis ticket implementation. Tickets gain a
server-issued channel binding (default chat for compatibility). Topics-only sockets avoid
requiring Chat history initialization and have independent listener ownership; both modules
use the same identity, origin and one-use-ticket checks. Separate browser module sockets on
the same server/namespace are intentional to avoid changing Chat connection lifecycle.
REST mutations; Topics WebSocket carries authorized invalidation/context events only.

## Data

Add StreamEvent.topicSequence, topicSettingsRevision and three settings booleans. Preserve
business updatedAt when advancing interaction revisions. Add EventTopic and EventTopicReply:
UUID, event FK, author kind/key, staff or registration FK, display name, clientOperationId,
immutable requestHash, text, creation sequence, version, createdAt/updatedAt, deletion metadata.
Root also has PENDING/APPROVED, wasPublic and nullable pinSlot 1..7. Root/reply author shape
CHECKs mirror the existing principal model. Composite parent/event and attendee/event FKs,
unique operation keys and pin slots, bounded text/tombstone/sequence checks. Soft deletion
redacts content; hashes retain retry identity. No migration of Mudu accounts or data.

All operations lock StreamEvent first (SHARE reads, UPDATE writes), then existing authority
rows in the established order. This coarse event lock serializes pins, parents, settings and
permission/event transitions, including Chat. Keep transactions short, test contention, and
report local limits. A finer topic aggregate lock is deferred until measured need.

## REST contracts

Staff base /api/v1/stream-events/:eventId/topics; attendee base
/api/v1/public/events/:eventId/topics. Explicit identity selection, private/no-store, UUIDs,
trimmed plain text 1..2000, unknown fields rejected, bounded requests.

| Method/path | Input / result |
|---|---|
| GET /context | current actor/capabilities/authority + settings/revision |
| POST /ticket | one-use 30s channel=topics ticket + context |
| GET / | filter all/approved/pending/pinned; before optional; limit 1..50; snapshot roots/replies, counts, nextBefore, watermark, context |
| POST / | clientOperationId UUID, text; canonical root result |
| POST /:id/replies | clientOperationId UUID, text; canonical parent result |
| PATCH /:id | text, expectedVersion; canonical root |
| POST /:id/approve | expectedVersion |
| POST /:id/pin | pinned boolean, expectedVersion |
| DELETE /:id | expectedVersion in JSON |
| DELETE /:id/replies/:replyId | expectedVersion (parent); soft-delete reply |
| PATCH /settings | all three booleans, expectedRevision |

Replies are one level, capped at 100 per root for bounded snapshots. Roots use keyset creation
sequence; pinSlot defines pin order. Loaded window starts at 20 and grows to 100. Refresh
rebuilds all loaded pages with identical watermark/authority; bounded retries on contention.
Counts apply visibility before grouping and distinguish totals from loaded rows. Deleted roots
are absent from snapshots; responses never expose private entities through a stale command.

## Socket / frontend consistency

Topics ticket authenticates the same event principal in the current Gateway. topics.ready
contains context; topics.context revalidates identity/capabilities/settings; topics.changed
contains eventId/topicId/revision only after recipient visibility checks. Previously-public
roots can invalidate previous readers when re-entering PENDING or deletion; never-public
pending IDs go only to author/moderator. topics.denied is terminal for actual 401/403/404;
topics.unavailable is retryable. Periodic gateway authority checks every 3s, REST snapshot
repair every 5s, and a fresh authorized snapshot on reconnect repair lost notifications.
Private notifications are not a contiguous replay log; no gap detection from Topic revisions.

Canonical snapshots replace a normalized map; no speculative moderation or blind ACK merges.
Create/reply inputs and operation IDs survive an uncertain response for explicit retry.
Authority/filter/event/actor generations fence delayed responses. Unverified state is hidden
on disconnect/revocation; unrelated module state and listeners remain untouched.

## Checkpoints and verification

1. Commit task + plan (this checkpoint).
2. Shared identity extraction, additive migration, Topics REST/constraints and Gateway channel.
3. App Router staff/attendee feature, canonical state, settings/moderation/retry UI.
4. Unit/state + real PostgreSQL/WS concurrency/security tests and browser workflow.
5. Run original regressions including Chat recovery, builds/type/lint; fix in-scope failures.
6. Record actual evidence/report, stable commits and restore ordinary local services.

Use a new disposable *_test database and Redis DB/bucket, not the ordinary development DB.
Seed once only in that new database. No reset or replacement of old audit/development data.
