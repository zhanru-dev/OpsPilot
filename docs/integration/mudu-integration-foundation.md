# StreamOps interaction foundation — implementation contract

## Scope and baselines

Destination: OpsPilot `0e005c193769d67a945e98229a1f2707163d8f52` (clean).
Source: independently authored Mudu Engineering Showcase `7bd9a2f36df8d0992260e1ba356754d6fce05f63`.
Source has two untracked historical streaming acceptance artifacts, which remain untouched.
Only Chat and essential integration infrastructure are included. No source data, accounts,
historical captures, branding, private research, Topics, Media or broadcast code are copied.

The source remediation report and code establish that the reported P1 live session
selection defect was repaired by prioritising active sessions and immutable creation order;
the client separately fences room and entity revisions. The P2 callback credential issue
was repaired by moving the secret out of query parameters into Basic authentication,
with real refused/timeout/503 callback tests and sanitized evidence. The local test secret
was rotated. These fixes are outside this migration; no source secrets or log contents
are imported. No evidence establishes exposure of production credentials.

## Plan and checkpoints

1. Record contracts; install and run the existing baseline against isolated services.
2. Add additive Prisma migration, event authorization, history and durable Chat journal.
3. Add ticket authentication and event-scoped WebSocket delivery/commands.
4. Adapt bounded normalized Chat state, recovery and scroll handling into existing UI.
5. Run real PostgreSQL, sockets, browser and existing regression suites; fix in-scope issues.
6. Record exact evidence, limitations and reviewable Git checkpoints.

## Event and principal contract

`StreamEvent.id` is authoritative; there is no Room or second workspace hierarchy.
Principal references are discriminated staff `{kind, sessionId, userId, workspaceId}`
and attendee `{kind, sessionId, registrationId, eventId}`. These are server-derived;
client sender/role/workspace claims are rejected. DTO identity IDs are namespaced
`staff:<userId>` or `attendee:<registrationId>`. Names are snapshots, never authority.

Staff REST routes use the existing access JWT and additionally validate current Session,
expiry/revocation, User and WorkspaceMembership in PostgreSQL on every operation.
Attendee routes exclusively use the event-path attendee cookie and existing eligibility
rules (verified registration, consent, invitation/domain policy, READY or LIVE event).
Invalid attendee authentication never falls back to a staff cookie.

All current workspace roles can read event Chat. ADMIN, OPERATIONS_MANAGER and
CONTENT_OPERATOR can send during READY/LIVE; ADMIN and OPERATIONS_MANAGER can
moderate. ANALYST and VIEWER are read-only. Admitted attendees can read/send in
READY/LIVE and cannot moderate. Staff retain history and moderation access after closure.
No new general RBAC administration is introduced. Future topics.* / broadcast.manage
capabilities remain extension points, not implemented permissions.

The event lock serializes Chat writes and existing event/access-policy transitions.
Current principal/session/membership/registration/invitation rows are locked for protected
operations so a committed revocation precedes subsequent authorization. An operation
already authorized while holding its locks may complete before revocation commits.
Delivery is authorized individually immediately before emit; bytes already sent cannot
be recalled. Idle sockets are revalidated within a documented short periodic interval.

## REST and WebSocket contracts

Staff base: `/api/v1/stream-events/:eventId/chat`.
Attendee base: `/api/v1/public/events/:eventId/chat`.
All responses are private/no-store; IDs must be UUIDs, unknown mutation fields rejected.

| Operation | Contract |
| --- | --- |
| GET /context | actor, effective read/send/moderate capabilities, authority fingerprint |
| POST /ticket | one-time random ticket, 30-second TTL, bound to event and parent session |
| GET /messages | before OR after creation sequence; limit 1–50, default 30; consistent watermark and pagination |
| GET /events | after journal sequence, optional fixed through watermark; limit 1–200 |
| POST /messages | clientMessageId UUID, trimmed plain text 1–2000 chars |
| DELETE /messages/:messageId | current moderator only; idempotent tombstone |

Socket.IO namespace `/chat`, default transport path, WebSocket transport. An explicit
allowed Origin and handshake `{ticket}` are required. Redis atomically consumes tickets;
parent authority is rechecked. Reconnection obtains a fresh ticket through its original
REST identity route. No bearer credentials in URLs or logs; tickets live in browser memory.
`chat.send` and `chat.delete` use the same service contracts as REST, returning structured
ACKs. `chat.event` carries eventId, contiguous sequence, kind and canonical message.
`chat.context` updates effective permissions; `chat.denied` clears private UI state.
The socket is bound to one event; changing identity/event creates a fresh scope.

## Persistence and recovery

Add `StreamEvent.chatSequence`, `EventChatMessage` and `EventChatEvent`. Messages have
UUID canonical ID, event FK, sender kind and principal ID, display-name snapshot,
immutable client operation UUID, text/hash, creation sequence, entity version and
moderation timestamp/actor. SQL checks enforce sender shape and positive sequences;
event+sender+client ID is unique. Event+creation sequence supports keyset history.
The journal references the canonical message and has unique event+sequence.
Every mutation atomically increments the event sequence, updates the message and appends
one journal entry. Deletion redacts text while retaining the request hash for retry checks.

Identical retries return the original canonical result, even after deletion; changed text
with the same operation ID conflicts. ACKs never advance the stream cursor. Entity versions
and tombstones prevent old ACK/history/event payloads resurrecting deleted text.
Snapshot and journal watermark use a consistent PostgreSQL transaction. Replays return
current canonical message state, including tombstones, rather than old deleted content.

Direct notifications provide low latency; durable journal replay and periodic recovery
repair dropped notifications, including a crash after commit/before emit. This does not
repurpose the business webhook outbox or replace operational SSE. Single API process
is the initial deployment target; multi-process delivery needs a shared socket adapter or
per-process journal notification strategy, while REST replay remains authoritative.

## Frontend boundary

One App Router client feature is embedded in staff Live Operations and the existing
verified attendee confirmation page next to polls. Existing shell, login, email admission,
design components and API wrapper remain authoritative. Scope keys include event and
principal; abort controllers and generation fences discard stale responses and timers.

Adapt independently authored Mudu reducer algorithms: bounded 300-message window,
500 tombstones, 2000-event replay budget; canonical reconciliation, uncertain sends with
same-ID retry, batched bursts, older/newer pagination, anchor preservation and unread IDs.
Disconnected private state is hidden until authority and missed events are revalidated;
compatible reconnect retains reader position. Excess replay uses an explicit latest-page
refresh notice, with older history still accessible. DOM rendering uses escaped plain text.

## Validation and future boundaries

Use a separate Compose project, database ending `_test`, Redis and object storage. Existing
seed is destructive and may only run in this disposable environment. No reset of shared
databases or deletion of existing uploads. Run baseline checks before source changes.
Then test real cookies/admission, PostgreSQL constraints, independent sockets, ticket
expiry/reuse, dynamic permissions, room/workspace isolation, lost ACKs, replay and browsers.

Future Topics uses StreamEvent and the same principal boundary but separate entities;
future BroadcastSession must not be confused with existing operational LiveSession;
future Media adapts OpsPilot storage rather than importing Mudu storage/accounts.
