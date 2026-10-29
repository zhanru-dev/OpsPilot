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
READY/LIVE and cannot moderate. Staff retain history and moderation access after closure,
except ARCHIVED events, which remain immutable and read-only.
No new general RBAC administration is introduced. Topics capabilities are documented in the
Topics extension below; broadcast.manage remains a future extension point.

The event lock serializes Chat writes and existing event/access-policy transitions.
Current principal/session/membership/registration/invitation rows are locked for protected
operations so a committed revocation precedes subsequent authorization. An operation
already authorized while holding its locks may complete before revocation commits.
Delivery is authorized individually immediately before emit; bytes already sent cannot
be recalled. Idle sockets are revalidated every 3 seconds under healthy conditions.
Transactions use PostgreSQL READ COMMITTED plus explicit event and authority row locks.
An event SHARE lock keeps history and its watermark consistent; mutations use UPDATE.

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
`chat.context` updates effective permissions. `chat.denied` carries status 401/403/404 and
clears private UI state without retrying access. Transient initialization/replay failures
use `chat.unavailable`; the client discards the socket, requests a fresh one-use ticket,
and revalidates authority plus missed history before exposing messages again. Initialization
failure closes the incomplete subscription. A handshake 401 can mean an expired ticket;
the fresh REST ticket request determines whether the parent session remains valid.
Offline clients can also request an immediate retry; denied clients cannot bypass rejection.
See the [reconnection remediation evidence](../acceptance/opspilot-chat-reconnection-remediation.md).
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
Updating the Chat sequence deliberately preserves the business event's `updatedAt`.
Unexpected database failures return a generic 503 so message text in Prisma diagnostics
does not enter the existing persistent application error-report stream.

Identical retries return the original canonical result, even after deletion; changed text
with the same operation ID conflicts. ACKs never advance the stream cursor. Entity versions
and tombstones prevent old ACK/history/event payloads resurrecting deleted text.
Snapshot and journal watermark use a consistent PostgreSQL transaction. Replays return
current canonical message state, including tombstones, rather than old deleted content.

Direct notifications provide low latency; durable journal replay and periodic recovery
repair dropped notifications, including a crash after commit/before emit. Gateway repair
runs every 3 seconds; the browser also repairs through REST every 5 seconds. This does not
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

Topics now uses StreamEvent and the same principal boundary with separate entities;
future BroadcastSession must not be confused with existing operational LiveSession;
future Media adapts OpsPilot storage rather than importing Mudu storage/accounts.

## Topics extension (2026-10-29)

Topics/Q&A is the second integrated slice. The former future Topics boundary is now
implemented; BroadcastSession/Media migration remain deferred. See the
[approved scope](topics-integration-task.md), [API/data plan](topics-integration-plan.md)
and [migration and verification report](topics-migration-report.md).

`EventIdentityService` now owns the original Chat current-session, workspace membership,
attendee admission and event access checks. `ChatAuthorizationService` delegates to it and
retains its previous Chat capability contract and authority fingerprint. Topics derives its
own capabilities and settings from the same verified principal; no new account/room/RBAC
store was introduced. Topics controllers live in the existing Chat module so they can use
the ticket issuer without a circular module dependency.

Both modules use the existing `/chat` Socket.IO Gateway. Redis tickets additionally bind a
server-selected channel (`chat` default or `topics`); a Topics socket cannot invoke Chat
commands. The browser uses independently owned sockets on the same server and namespace,
so unmounting/filtering Topics cannot remove Chat listeners. SSE, Live Operations and Polls
remain separate. Topics mutations use REST; authorized WebSocket notices contain IDs and
revisions, not question bodies. Snapshots, not a second durable event journal, recover
missing notices. The recovery bound is a healthy 5-second snapshot poll plus request time;
idle authority checks remain 3 seconds. No instantaneous revocation or exactly-once transport
claim is made.

The additive `20261029010000_event_topics` migration adds event settings/revisions,
`EventTopic` and `EventTopicReply`, using existing staff/attendee relations. Seven nullable pin
slots, a unique event/slot index, CHECK constraints and event-first write transactions enforce
pin limits. Shared event locks serialize Topics with Chat/event transitions; independently
numbered topic revisions never advance Chat's replay cursor. Snapshots and counts apply
pending-content visibility before filtering or pagination. A formerly public question going
back to review invalidates previous readers without authorizing them to see the new text.
