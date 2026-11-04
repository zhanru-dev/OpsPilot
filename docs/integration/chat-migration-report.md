# Mudu → OpsPilot: foundation and Chat migration

Verification date: 2026-10-28. Scope: integration foundation and Chat only.
The implementation keeps OpsPilot's product, App Router shell, Workspace/StreamEvent
model, staff authentication, attendee admission, design system, operational SSE and polls.
No Topics, Mudu Media Library or Live Streaming migration is included.

## Baseline, provenance and source defects

| Repository | Reviewed revision | Changes in this phase |
| --- | --- | --- |
| OpsPilot | `0e005c193769d67a945e98229a1f2707163d8f52` | Destination; originally clean |
| Mudu Engineering Showcase | `7bd9a2f36df8d0992260e1ba356754d6fce05f63` | Read-only; original untracked streaming acceptance files preserved |

Before implementation, the source Chat implementation, upgrade/acceptance documentation,
OpsPilot admission/RBAC/SSE flows and Prisma model were reviewed. The API and actor
contracts were committed first in `f04ebe3`; see [foundation](mudu-integration-foundation.md).

Mudu's `docs/acceptance/live-streaming-remediation.md` and repaired code establish:

- P1 session selection: active sessions have priority; otherwise immutable creation order
  selects the latest session, with separate client room/entity revision fences.
- P2 callback diagnostics: credentials were removed from query parameters, Basic header
  authentication is required, and transport errors mask URL userinfo. The source report
  records real refused/timeout/503 tests and rotation of the exposed isolated test secret.
- No production credential exposure was established. No secrets or raw callback logs were
  imported. If an independently deployed old environment retained credentials in logs,
  its operator still needs to redact those logs and rotate the affected credential.

These source repairs were already complete. They were inspected, not re-executed or
modified during this migration. Historical captured Mudu behavior remains reference
material: the Event identity, attendee principal and authorization contract below are new
OpsPilot design, not claims about the historical Mudu production system.

## Reuse and adaptation

| Area | Treatment |
| --- | --- |
| Independently authored Mudu Chat reducer | Adapted normalized canonical merges, operation IDs, tombstones, bounded windows and gap recovery to event-scoped staff/attendee identities |
| Chat transport and scroll approach | Adapted ACK/event separation, replay watermark, batch rendering, reading anchors and unread behavior |
| Backend | Rewritten for OpsPilot Prisma models, current workspace membership, attendee eligibility, event lifecycle and existing Nest modules |
| Frontend hook and panel | Rewritten as App Router client components using existing API helper, Button, icons and styles |
| Authentication | Reused existing staff cookies/JWT sessions and verified event-path attendee cookies; no new login system |
| Testing | Added real database/socket/browser tests to existing Jest/Playwright infrastructure |
| Intentionally excluded | Mudu User/Room/Session schemas, Pages Router pages, historical bundles/assets/branding/private research, Topics, media and broadcast implementation |

## Architecture and contracts

`StreamEvent.id` is the sole interaction scope. Staff and attendee IDs remain distinct:
`staff:<userId>` versus `attendee:<registrationId>`. The backend derives both from existing
authenticated sessions and rejects client sender/role/workspace claims.

The new `event-chat` Nest module owns authorization, REST, persistence and the `/chat`
Socket.IO gateway. A small types-only `packages/chat-contracts` package shares wire shapes;
the browser independently validates responses with Zod. Existing SSE continues to deliver
operational snapshots. Chat does not use or rewrite the webhook outbox.

Staff use `/api/v1/stream-events/:eventId/chat`; attendees use
`/api/v1/public/events/:eventId/chat`. Each offers context, socket ticket, paginated message
history, bounded journal replay, message send and moderation endpoints. See the foundation
document for the exact contracts and limits.

Every operation rechecks current PostgreSQL session and authority rows. JWT role claims
do not authorize Chat by themselves. All workspace roles can read; ADMIN and
OPERATIONS_MANAGER can moderate; they and CONTENT_OPERATOR can send during READY/LIVE.
Admitted attendees can read/send in their own READY/LIVE event, with no moderation.
ARCHIVED Chat is read-only for staff. Closing an event removes attendee access.

An attendee's event-path cookie cannot accompany a generic Socket.IO handshake. Therefore,
the appropriate authenticated REST route issues a random one-use, 30-second ticket.
Redis stores only its SHA-256 key and event/principal binding; atomic GETDEL prevents reuse.
The socket validates Origin and current parent authority and stays bound to one event.
It cannot join a client-chosen room. Every command and individual event delivery rechecks
current authority. Idle checks run every 3 seconds; browser REST repair runs every 5 seconds.

## Database migration and consistency

Additive migration: `prisma/migrations/20261028095000_event_chat/migration.sql`.

- `StreamEvent.chatSequence` is the contiguous event journal watermark.
- `EventChatMessage` has canonical UUID, event, distinct staff/attendee references,
  immutable client operation UUID, author name snapshot, normalized text hash,
  creation sequence, entity version and moderator/deletion metadata.
- `EventChatEvent` records CREATED/DELETED and references the canonical message.
- Unique event/actor/client-operation IDs enforce idempotency. Event/creation sequence
  indexes support keyset history. SQL checks enforce sender shape, text/tombstone shape
  and positive sequences. Composite attendee/event and message/event foreign keys prevent
  cross-event references.

READ COMMITTED transactions take an event UPDATE lock for mutations, SHARE for reads,
and lock the relevant mutable authority rows. Message, sequence and journal commit together.
Chat sequence updates preserve the business event's `updatedAt`. A failed journal write
rolls the message and sequence back; unexpected database diagnostics become generic 503s
so message text cannot enter the existing persistent error reporter.

Same operation ID and text return the same message; changed text conflicts. Removal clears
text, retains the hash, and appends one tombstone. Replay returns current canonical state,
so an older creation event does not expose deleted text. ACKs never move the replay cursor.
Notifications are hints: periodic journal pumps and REST replay recover a lost notification.

Only the disposable `opspilot_chat_test` database was migrated in this phase. Existing
OpsPilot migrations remain unchanged. Deploy to a populated environment with `db:deploy`,
never `db:reset` or demo seed. No shared or Mudu database was reset.

## Frontend behavior

Staff Chat is embedded in existing Event → Live Operations, including READY events without
an operational LiveSession. Attendee Chat is on the existing email-confirmed admission
surface beside polls. No public Watch Room or player was added.

The feature keeps one canonical state per event, actor and mode. Epoch checks, abort
controllers, keyed mounts and subscription cleanup fence delayed requests and identity
changes. Offline private transcripts are hidden pending authority/replay validation, while
a compatible reconnect preserves the reader's anchor. A second event-path attendee cookie
can coexist in the same browser; a staff cookie never substitutes for admission.

Rendering batches socket events at 50 ms or 100 events, keeps at most 300 message rows and
500 tombstones, and offers older/newer pagination, unread counts and jump-to-latest.
Unknown send outcomes retain their client ID for retry. Plain text is React-escaped.
Recovery beyond 2,000 events explicitly refreshes the latest snapshot and shows a notice.

## Test environment and actual execution

Local environment: macOS 26.6.2 x86_64, Node 22.20.0, npm 10.9.3, Docker Desktop,
PostgreSQL 17, Redis 7.4.10, isolated MinIO and Mailpit. Playwright used installed Chrome
and independent browser contexts. Docker Node base resolved to 22.23.4.

`docker-compose.chat-test.yml` uses its own project, persistent volumes and loopback ports
5546/6381/9002/9003/1026/8025. `scripts/with-chat-test-env.mjs` generates ignored 0600
secrets and forces those services. No external service credentials were needed.

Original baseline passed types, lint, build, 89 unit tests, 28 API integration tests and
9 real browser tests before Chat was introduced. Final execution after the dependency
updates and archived-event fix:

| Exact command (from repository root) | Result |
| --- | --- |
| `npm ci` | PASS, fresh locked install |
| `node scripts/with-chat-test-env.mjs npm run db:generate` | PASS |
| `node scripts/with-chat-test-env.mjs npm run db:deploy` | PASS, migrations current |
| `npm run typecheck` | PASS, API and Web |
| `npm run lint` | PASS, API and Web |
| `npm test --workspace=@opspilot/api -- --runInBand` | PASS, 91 tests / 14 suites |
| `npm run test:chat:state` | PASS, 5 tests |
| `node scripts/with-chat-test-env.mjs npm run test:e2e --workspace=@opspilot/api -- --runInBand` | PASS, 40 tests / 4 suites (12 Chat + 28 existing) |
| `node scripts/with-chat-test-env.mjs npm run test:ui` | PASS, 11 real browser workflows (2 Chat + 9 existing), 2.7 minutes |
| `node scripts/with-chat-test-env.mjs npm run test:ui:isolated` | PASS, 12 mocked UI regressions, 32.5 seconds; supplementary evidence only |
| `node scripts/with-chat-test-env.mjs npx playwright test e2e/chat.spec.ts --output=.runtime/chat-browser-evidence` | PASS, both Chat workflows; retained measurements/screenshots separately from UI regression output |
| `node scripts/with-chat-test-env.mjs npm run build` | PASS, Nest and Next production builds |
| `npm audit --omit=dev --registry=https://registry.npmjs.org` | PASS, zero production findings |
| `npm audit --registry=https://registry.npmjs.org` | 9 low development-tool findings; no moderate/high/critical |

Image commands (all passed; API/worker repeated after packaging repair):

```sh
docker build --target api -f apps/api/Dockerfile -t opspilot-api:chat-integration .
docker build --target worker -f apps/api/Dockerfile -t opspilot-worker:chat-integration .
docker build -f apps/web/Dockerfile -t opspilot-web:chat-integration .
node scripts/with-chat-test-env.mjs node scripts/check-chat-containers.mjs
```

Container startup/restart **passed**: API readiness, worker readiness, Web login page,
authenticated history from PostgreSQL after API restart, and WebSocket authentication
after restart. See [verification JSON](chat-verification.json), pinned to tested code
`ba19080`.
The smoke script uses production images with isolated local test configuration, creates
only its own disposable event/containers, and removes those containers afterward. It is
not a hosted HTTPS production deployment test.

### What the tests establish

- Two independent authenticated staff/attendee sockets; real SMTP/browser admission;
  Unicode/plain-text persistence, reload, moderation and both clients' reconciliation.
- Eight concurrent same-ID sends create exactly one record; changed payload conflicts;
  deleted messages cannot be resurrected by stale ACK/history/events.
- Real WebSocket ACK loss and browser-frame loss produce an uncertain state; same-ID
  retry resolves exactly once. A suppressed notification hint is recovered from PostgreSQL.
- Multi-page replay, stable forward/backward history, 430 missed messages, 450-message
  live journal burst, unread counts, preserved reading anchor and bounded DOM.
- Current membership downgrade/removal, logout, attendee expiration/revocation, closure
  and archive checks; wrong event/workspace, role/sender injection and invalid ticket denial.
- Same browser with two event-scoped attendee identities and with both staff/attendee
  cookies; logout/revocation clears private content. Untrusted text remains literal text.
- A real PostgreSQL journal constraint failure rolls back the mutation; SQL rejects
  impossible sender and cross-event reference shapes.

### Regression status and scope

| Existing OpsPilot area | Evidence / result |
| --- | --- |
| Staff authentication | API login, refresh rotation, logout, session/cookie checks; PASS |
| Event management | Launch readiness through Archive, tenant ownership and immutable archive; PASS |
| Registration/admission | Public registration, real email, restricted invitation/domain policy and revoke; PASS |
| Live Operations / SSE / polls | Independent manager/analyst updates, poll lifecycle, attendee votes and REST fallback; PASS |
| Permissions | Analyst read-only, cross-workspace denial, current Chat membership and attendee revocation; PASS |
| Existing media/integrations | Existing attach/detach/workspace checks, processing/signature units and reliability browser surfaces; PASS |

The media regressions do not establish a fresh end-to-end upload/transcode benchmark.
No Mudu Topics, media or streaming tests are claimed as OpsPilot migration tests.

## Findings fixed during verification

1. Preserve `StreamEvent.updatedAt` when incrementing Chat sequence, so interaction traffic
   does not masquerade as edits to the operational event. Added integration assertion.
2. Redact unexpected database errors before existing error-report persistence; retained
   rollback/retry test with a real database constraint fault.
3. Reject moderator deletion after ARCHIVED, preserving OpsPilot's lifecycle invariant.
4. Production image startup initially failed because a dependency was nested under
   `apps/api/node_modules`, while the image copied only root dependencies. API/worker images
   now preserve both locations. Startup verification was added rather than accepting build alone.
5. Original baseline and initial migrated dependency locks both had the same 11 production
   audit findings (2 critical, 7 high, 2 moderate). Same-major Next/Nest and transitive patches,
   including Multer 2.5 override, cleared them. Development critical findings were patched
   too. Nine remaining low findings trace to `deepmerge` through Jest/Nest tooling; no unsafe
   forced major/downgrade was applied. Configured npm mirror lacks audit support, so audit
   evidence uses the official registry.

Test-development corrections were explicit: history anchoring measures the original visible
row after prepend, rather than assuming it stays the first row; revoked admission may
unmount Chat entirely; the pre-existing mocked poll fixture now handles `/chat/ticket`
separately rather than counting every POST as a poll mutation. Assertions still require
preserved anchor, zero private rows/enabled composers and unchanged poll behavior.
An initial overlapping local build hit Next's build lock; a serial rerun passed. Initial
Docker registry metadata resolution was slow; final unmodified Dockerfiles built successfully.

## Measured observations and limits

The retained browser probe recovered **430 journal events in 1,474 ms**, preserving the
original older reading anchor within 3 px. A **450-event live journal burst took 3,736 ms**
to appear at its last message; the DOM contained **300 message rows**, and the composer
remained usable. Timing includes fixture insertion, scheduling, network and browser assertions.

These workloads insert valid committed messages and journal records directly into the
isolated database; delivery/replay/rendering use the real backend. They do **not** measure
API send throughput, typing latency during every burst frame, long-term memory growth,
or production capacity. No 500-client load test or multi-node deployment was executed.

## Decisions, alternatives and remaining risks

- Event row locking gives simple atomic order and consistent authorization/watermarks.
  A hot event is serialized; larger workloads may need a dedicated per-event counter or
  ordered broker. Neither is justified by the measured local workload yet.
- One-use tickets preserve existing path-scoped attendee cookies and avoid long-lived
  access tokens in socket URLs. Direct cookies would require widening the attendee cookie
  scope; a second authentication system was rejected.
- Journal replay repairs transport loss without rebuilding SSE. A shared Socket.IO adapter
  and cross-process notification mechanism are needed for consistently low latency at
  horizontal scale; the tested deployment is one API process.
- Revocation checks run under locks at protected boundaries. Previously delivered bytes
  cannot be recalled; idle UI invalidation has a 3-second gateway / 5-second browser cadence
  under healthy services, not a strict wall-clock guarantee during network failure.
- Database journal/tombstones currently have no retention job. Client memory is bounded;
  long-term storage retention and account-erasure semantics remain future policy work.
- Pending messages/drafts are memory-only. Reload recovers committed messages, but may
  lose an unsent draft or locally uncertain operation. Recovery beyond 2,000 events uses
  the documented latest-page fallback; earlier history is still queryable.
- Chat's current-authority checks do not replace existing non-Chat JWT/RBAC behavior.
  Staff can read all events in their current workspace by OpsPilot's existing domain rules.
- Per-socket command limits and connection cap are defensive bounds, not distributed abuse
  protection. The remaining low development dependency findings are documented debt.
- Hosted TLS/reverse-proxy deployment is not verified here. Forward `/socket.io` WebSocket
  upgrades to the API, preserve the allowed web Origin, and configure secure cookies/TLS.

## Run, verify and checkpoints

Follow the [isolated setup and two-user walkthrough](../../README.md#chat-integration-isolated-local-environment).
Stop the development server before full browser suites (which manage their own servers)
and before the container smoke script (which uses 3000/4100). Do not seed between tests.
The database and storage persist when services stop; never use `down --volumes` to preserve them.

- `f04ebe3`: plan, actor/API contracts and isolated infrastructure.
- `f688f34`: additive schema, current-authority backend, tickets, sockets and integration tests.
- `e62d955`: staff/attendee UI, recovery/scroll behavior and browser tests.
- `3e02738`: same-major security dependency updates.
- `ba19080`: archive immutability, workspace dependency packaging and container restart verification.
- Documentation follows that tested code on `feat/streamops-chat-integration`.

The work stops after Chat. Future Topics must use separate entities; future broadcast
must distinguish streaming sessions from OpsPilot's operational LiveSession; future media
must adapt the existing OpsPilot storage boundary. None is implemented by this migration.
