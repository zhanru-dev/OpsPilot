# OpsPilot StreamOps Topics / Q&A migration report

Implementation and verification: 29 October 2026 (Europe/London).
Implementation verification complete: no unresolved P0/P1 defect was found within
the tested integration scope. This is an implementation report, not a separate
independent acceptance audit; limitations below remain explicit.
Scope: text Q&A integrated into the existing OpsPilot product. Media, attachments,
BroadcastSession and Mudu Live Streaming migration were not started.

Subsequent acceptance found P1-01 (lost receipt followed by 429) and P2-01
(unsaved edit lost on row invalidation). The historical implementation results
below do not supersede that audit. See the [acceptance remediation report](../acceptance/opspilot-topics-remediation.md)
for the fixes, additional real-browser regressions and current limitations.

## Baseline and checkpoints

Destination `/Users/ruzhan/computer_science/projects/OpsPilot`, branch
`feat/streamops-chat-integration`, clean at `b09f5a2`. The user-supplied historical
Chat checkpoint was `cdd9242`; subsequent accepted recovery implementation is
`1ac03b4`, documented at `b09f5a2`. The original independent FAIL review is preserved
as historical evidence, not presented as the current result.

Source `/Users/ruzhan/computer_science/projects/mudu-engineering-showcase`, HEAD
`7bd9a2f36df8d0992260e1ba356754d6fce05f63`. Its pre-existing untracked streaming
acceptance report/evidence directory were unchanged. No source-repository writes,
accounts, migration histories, captured bundles, branding or private research
material were copied into OpsPilot.

- `065e23c`: approved updated task and preimplementation architecture/contracts.
- `ec2922e`: shared identity, additive database, Topics REST and Gateway integration.
- `cea13ea`: App Router staff/attendee Q&A, canonical snapshots and browser coverage.
- `d7bba04`: retained operation feedback, precise shared-transport fault injection,
  duplicate/reordered notices, lost-reply receipt and mobile/paging verification.
- Documentation/fixture closeout: the commit containing this report.

The [updated task](topics-integration-task.md) resolves role/lifecycle, editing,
reply deletion, review settings, idempotency, privacy and recovery semantics before
implementation. The [plan](topics-integration-plan.md) gives exact API contracts.

## Delivered functionality

Staff Live Operations and the existing admitted-attendee confirmation page now
contain **Questions & answers**, alongside Chat and the existing Polls/operations
features. Attendees use the normal registration, email verification and admission
flow. There is no new public login or workspace membership for attendees.

Create questions; list all/approved/pending/pinned projections; page history;
approve; reply; edit roots; pin/unpin; delete roots and individual replies. The
settings panel controls audience questions, audience replies and required review.
Every setting affects service authorization, not merely control visibility.
Pending counts and bodies are visible only to the author/current moderators.

Question/reply submissions carry stable operation IDs. The UI retains text and
operation IDs for explicit retries after uncertain responses, including a reply
card invalidated by its own successful submission. Draft ownership is scoped to
the event and identity; canonical server entities remain separate. Moderator
operations are pessimistic and use expected versions; conflicting intent returns
409 and refreshes authoritative state. Unknown delivery is never reported as a
confirmed failure or silently assigned a new operation ID.

## Source and destination mapping

| Source reference, read only | Reused behaviour | OpsPilot implementation |
|---|---|---|
| Mudu `apps/api/src/topics.service.ts` and completed upgrade | Event serialization, seven slots, parent eligibility, idempotency, review/edit rules | Reimplemented in `apps/api/src/event-topics/topics.service.ts` against StreamEvent and existing principals |
| Mudu `apps/web/src/features/topics/state.ts` / `useTopics.ts` | Canonical maps, content-free invalidation, consistent snapshots, stale-response fences | Adapted algorithms in `apps/web/src/features/topics/{state,use-topics,protocol}.ts` |
| Mudu `TopicsWorkspace.tsx` | Focused moderation workflow | New `topics-panel.tsx`, existing OpsPilot buttons/tokens, App Router composition |
| Source Topics integration/browser tests | Adversarial cases and business invariants | New real PostgreSQL/Redis/Socket.IO Jest suite and Playwright scenarios |
| OpsPilot Chat authorization/tickets/Gateway | Current principal validation, one-use tickets, origin policy, event scope | Extracted `EventIdentityService`; compatible Chat wrapper and channel-bound tickets |

Historical source analysis supports status filtering, parent replies, editing,
audience controls, approved-only/seven-pin rules and unpin-before-delete. It does
not prove that historical Mudu used Prisma, PostgreSQL, Socket.IO, these transaction
locks or this recovery design. These are independently authored showcase ideas
adapted or newly implemented here. Source technical/upgrade/acceptance documents
were references; their test claims are not evidence for this destination build.

## Database changes and invariants

Additive migration: `prisma/migrations/20261029010000_event_topics/migration.sql`.
It adds `TopicStatus`, five StreamEvent settings/revision fields, `EventTopic` and
`EventTopicReply`. Existing migrations and existing business tables remain intact.

Both entity types have UUID canonical IDs, event scope, staff/attendee principal
shape, author-name snapshot, immutable operation ID/hash, text, creation sequence,
current version, timestamps and deletion metadata. Roots additionally have status,
`wasPublic`, pin slot and moderator metadata. Replies belong to a root, never
another reply. Composite parent/event and attendee/event foreign keys enforce
same-event references. Author shape, live/deleted text, hash, revision and pin
CHECKs complement unique operation/event/author and event/pin-slot indexes.

All writes first lock StreamEvent FOR UPDATE; reads lock it FOR SHARE. The shared
identity validator locks current session/membership/admission/invitation authority
in the existing order. Mutation and event revision commit in one transaction.
Event business `updatedAt` is deliberately not changed for interaction revisions.

- Only approved, nondeleted roots can occupy one of slots 1–7. Unique event/slot and
  the range CHECK make an eighth pin impossible; row locks serialize allocation.
- Pinning, approval, edits and deletion validate expected versions. A desired state
  already achieved returns the current result without another revision.
- Pinned roots must be unpinned before editing/deleting.
- Replies require an approved live parent. Parent deletion redacts root and all
  surviving replies atomically. In a reply/delete race, deletion rejects the reply,
  or the reply advances the parent version and stale deletion returns 409.
- Edits by an ordinary author return an approved root to pending when review is
  required. Replies remain stored but are hidden with that parent. A retry of the
  same edit cannot undo a subsequent approval.
- Changing review settings never retroactively approves pending roots.
- Root/reply operation hashes compare original normalized payloads even after edits
  or deletion. Retrying a deleted create returns a redacted tombstone.
- Parent eligibility and the 100-total-reply ceiling are transactional service
  invariants, not triggers against privileged direct SQL administration.

Before local-development deployment, a local pg_dump backup and content digests
were captured. Applying only this migration preserved all **38 existing tables**:
counts and content digests unchanged (including 5 events and 3 media assets).
No reset/reseed, upload deletion or storage replacement was performed.
The ordinary local Web/API/worker environment was restored at 3000/4100. Readiness,
login, authenticated Topics read/moderator capability and logout were smoke-tested
against that original local database without creating test questions there.

## Authentication, authorization and realtime

`EventIdentityService` reuses OpsPilot's verified staff session/current workspace
membership and attendee session/registration/invitation/event checks. REST route
families explicitly select staff versus attendee identity; invalid attendee access
never falls back to a staff cookie. Client author/role claims are rejected.

| Actor | Read | Submit/reply during READY/LIVE | Moderate | Configure |
|---|---|---|---|---|
| ADMIN / OPERATIONS_MANAGER | Yes, including pending | Yes, bypass review | Yes except ARCHIVED | Before COMPLETED/ARCHIVED |
| CONTENT_OPERATOR | Approved + own pending | Yes; review applies | No | No |
| ANALYST / VIEWER | Approved + own pending | No | No | No |
| Admitted attendee | Approved + own pending | Subject to audience settings/review | No | No |

Staff can read past event Q&A. Archived moderator roles retain pending visibility
but cannot mutate. Attendee lifecycle and admission remain the existing product's
policy. No new general permissions administration was built.

Same `/chat` Socket.IO Gateway/server, same Redis ticket issuer and same allowed
Origin. Ticket bindings add `channel=topics`; the server chooses the channel, not a
client role claim. Separate module-owned sockets deliberately isolate Chat cleanup
and recovery from Topics. A Topics ticket cannot install Chat command handlers.
SSE and Polls were not rewritten. Topics writes use authenticated REST; there are
no second, less-protected WebSocket mutation handlers.

`topics.ready/context` carry current effective authority. `topics.changed` carries
only event/topic/revision after recipient reauthorization. Never-public pending
IDs go only to the author/moderators. `wasPublic` allows a content-free invalidation
to previous public readers when an edit returns a question to review. It never
authorizes the new private body. True access loss emits `topics.denied`; transient
failures emit `topics.unavailable`, followed by fresh ticket/snapshot recovery.

Every operation rechecks current authority, including stale JWTs. An operation
holding authorization locks may finish before a racing revocation commits; future
operations cannot reuse the revoked authority. Idle socket checks occur every 3s
under healthy conditions. Previously delivered bytes cannot be recalled.

## Frontend consistency and recovery

Zod validates wire shapes. One normalized map represents the currently authorized
loaded window; projections derive from it. A snapshot replaces that window, so
missing/deleted parents and replies disappear together. Old watermarks are ignored
within the same authority. Duplicate/delayed invalidations cannot advance a verified
snapshot watermark. Unknown new visibility immediately hides an invalidated root.
Mutation responses do not blindly merge private or stale entities.

Reads are fenced by event, actor, filter, authority and request generation.
Disconnect hides unverified server state; reconnect uses a new single-use ticket
and fresh snapshot. AbortControllers, timers and the module-owned socket are
cleaned on unmount. Switching event/identity remounts the scope and drops local drafts.

History pages contain 20 roots (API max 50). Loading more grows a window up to 100.
Refreshing reloads all loaded pages, requiring identical authority/watermark across
pages, with up to three immediate attempts. Continuous contention produces a
retryable state and subsequent periodic repair, rather than an unbounded tight loop.
A healthy 5-second REST poll repairs lost notifications and the commit/emit gap.
Topics revisions are not a contiguous subscriber event log: gaps may be private
changes and are never interpreted as missing public messages.

## Actual test evidence

Environment: macOS x86_64, Node 22.20.0, npm 10.9.3, Next 16.4.3, Prisma 6.19.3,
PostgreSQL 17, Redis and installed Chrome via Playwright. Infrastructure uses
`docker-compose.chat-test.yml` (Postgres 5546, Redis 6381, MinIO 9002/9003,
Mailpit 8025/SMTP 1026). Nest and Next use 4100/3000.

Tests used a new **`opspilot_topics_20261029_test`** database, Redis DB **11**, bucket
**`opspilot-topics-20261029`**, and suite-owned disposable fixture records. This
new database was seeded once. It was never substituted for the ordinary local
application database. The optional AI provider remained disabled.

The exact local prefix used was:

```sh
node scripts/with-chat-test-env.mjs node .runtime/topics-integration/env.mjs COMMAND
```

The ignored `env.mjs` only spawns COMMAND with inherited environment and overrides:

```text
DATABASE_URL=postgresql://opspilot:local-test-only@localhost:5546/opspilot_topics_20261029_test?schema=public
REDIS_URL=redis://localhost:6381/11
S3_BUCKET=opspilot-topics-20261029
```

Equivalent reproducible prefix without that local file:

```sh
node scripts/with-chat-test-env.mjs env \
  DATABASE_URL='postgresql://opspilot:local-test-only@localhost:5546/opspilot_topics_20261029_test?schema=public' \
  REDIS_URL=redis://localhost:6381/11 S3_BUCKET=opspilot-topics-20261029 COMMAND
```

Create a new explicitly disposable database before deploying/seeding if reproducing
elsewhere; choose an unused database name ending `_test`. Never run the destructive
seed on an existing populated environment. Stop ordinary app processes before
browser suites so the suite cannot accidentally reuse another database's server.

| Command (test prefix where services needed) | Executed result |
|---|---|
| Baseline `npm test -- --runInBand` | 91 tests / 14 suites passed |
| Baseline API E2E + Chat state | 44 integration tests + 5 state tests passed |
| `npm run db:deploy`, `npm run db:generate` | Migration deployed and client generated |
| `npm run typecheck` | API and web passed |
| `npm run lint` | API and web passed |
| `npm test -- --runInBand` | 94 tests / 15 suites passed |
| `node --import tsx --test tests/chat-state.test.ts tests/topics-state.test.ts` | 10 tests passed |
| `npm run test:e2e --workspace=@opspilot/api -- --runInBand` | **60 tests / 5 suites passed**, 38.44s |
| `npm run test:topics:api` | 16 real DB/Redis/WS tests passed, 14.096s |
| `npm run build` | Nest and optimized Next production build passed |
| `env E2E_PRODUCTION_WEB=1 npm run test:ui` | **16 passed**, 2.3m, production standalone web + real API/worker |
| `env CHAT_RECOVERY_PRODUCTION_WEB=1 npm run test:chat:recovery` | **12 passed**, 1.5m, real timeout fault harness |
| `env E2E_PRODUCTION_WEB=1 npx playwright test e2e/chat.spec.ts e2e/topics.spec.ts` | **7 passed**, 2.0m, final duplicate/reordered frames, precise Chat fault selection and 390px Topics layout |
| `npm run test:ui:isolated` | **12 passed**, 33.1s; isolated HTTP-fixture UI regression, not substituted for real integration evidence |
| `env E2E_PRODUCTION_WEB=1 npx playwright test e2e/topics.spec.ts --grep 'admitted attendees and moderators'` | **1 passed**, 47.9s; repeated complete workflow with two different moderator accounts and asserted distinct actor IDs |

The integration suite covers persistence, visibility-scoped counts, author spoofing,
direct API/WS isolation, concurrent create/reply/approval, final pin-slot contention,
parent/reply races, stale edits, settings races, real SQL rollback, database CHECK/FK
violations, private/public notifications, revocation, expiry and archived behavior.
The browser suite uses actual staff login and Mailpit-backed attendee admission,
two distinct staff principals (Alex operations manager and Jordan admin), another participant's reply, settings, pins, review/edit,
reload, lost create/reply responses, real socket interruption, delayed snapshots,
pagination, event switching and simultaneous Chat participation.

### Failures investigated and corrections

1. The first migration-diff invocation lacked DATABASE_URL, leaving an empty
   generated section. Deploy failed on the first constraint statement, exclusively
   in the new disposable database. Correct SQL was regenerated with the explicit
   environment; the failed migration was marked rolled back there and deployed.
   No shared database was touched by this setup repair.
2. The first new API fixture omitted attendee eventId in its server principal.
   Tests correctly denied access. The fixture was corrected to the existing verified
   principal shape; no production authorization was relaxed.
3. New hook initialization failed the React lint rule for synchronous effect state
   resets. Filter state now resets during the guarded render transition, before
   stale projections can commit; event/identity still key the outer scope.
4. Code inspection found reply retry state could disappear when an invalidated row
   remounted. Locally authored drafts/operation IDs now live above snapshot rows;
   a real committed-reply/lost-response browser test verifies exactly one row.
5. The revocation test exceeded Jest's default 5s while awaiting two 3s authority
   checks and briefly overlapped subsequent fixtures. Only that test's deadline was
   set to 15s. Its denial/disconnect assertions remain intact; all 60 tests then passed.
6. The first Chat recovery regression run had 11 passes/1 failure: its helper closed
   the last socket, which could now be Topics. Helpers now identify actual Chat
   frames/tickets before interruption/rejected-ticket injection. All original
   assertions remain, with Chat-only connection counts; all 12 then passed.
7. The Polls-only HTTP fixture initially counted Topics connection tickets as poll
   mutations (10 passes/2 failures). Its existing explicit Chat-ticket 403 stub was
   extended to Topics tickets. Poll form/mutation assertions were not changed;
   real Topics transport and persistence remain covered in the integration suites.
   The final isolated UI run passed all 12 tests in 33.1s.

Logs and local browser artifacts are retained under `.runtime/topics-integration/`.
No credentials, email verification tokens, private research or raw diagnostic secrets
are copied into this report. Transient outbox retry logs from isolated fault tests
are not represented as successful external delivery.

## Regression assessment

- **Chat:** original real DB/WS suite passed; both ordinary browser workflows passed,
  including reader anchor, unread, lost ACK, moderation and bounded rendering.
  All 12 production-web fault recovery cases passed after precise test transport
  selection, including real PostgreSQL timeouts for staff and attendees.
- **Polls / Live Operations:** existing live manager/analyst vote workflow, operational
  launch flow, read-only role surface and responsive page regression passed. SSE
  implementation and poll persistence were not modified.
- **Authentication / admission / permissions:** original API suites and actual browser
  registration, email confirmation, signout, restricted invitation and revocation
  scenarios passed. Topics adds current-role, expiry and cross-event/workspace tests.
- **Media / analytics / integrations:** existing backend suites and browser reliability,
  media/webhook evidence and analytics surfaces passed. No Mudu storage pipeline was
  migrated. This is regression evidence, not a new comprehensive media acceptance audit.

## Observations, trade-offs and remaining limits

The production-web regression measured Chat recovery of 430 committed missed messages
in 1,510ms and a 450-message live batch in 3,508ms with 300 rendered rows. Fixtures
write directly committed journal records; browser delivery/recovery uses real REST/WS.
These are one local observation, not throughput targets or production-scale claims.
The final Topics paging scenario loaded 45 distinct roots in three pages without
duplicates; expanding the initial 20 rows to 45 took **475ms** locally. Staff desktop
and 390px attendee screenshots were visually inspected; the browser asserted no
horizontal page overflow. Metrics are saved in [local observations](topics-local-observations.json).

- Snapshot recovery trades bandwidth/latency for a small auditable privacy model.
  Notifications are process-local; different API replicas converge by polling.
  There is no Topic outbox/event replay log or instant multi-replica push guarantee.
- The existing 500-socket admission guard now covers both modules. A page normally
  owns two sockets; this does not imply support for 500 simultaneous participants.
- One event write lock simplifies correctness and shares contention with Chat and
  event transitions. Production load, long-running soak, multi-replica behavior and
  high-rate hostile traffic are not acceptance claims from these local tests.
- One level of text replies, 100 total ever-created replies per root, and at most
  100 loaded roots per filter. REST keyset pagination can retrieve older history;
  UI does not provide an archive browser beyond this live-event window.
- Each snapshot may contain up to 100 replies per root. UI initially renders the
  latest three and can expand. A separately paginated reply endpoint is an alternative
  if measured workloads justify the extra state/recovery protocol.
- No attachments, uploads, nested threads, voting, resolved states, independent
  permissions UI or video playback. Existing OpsPilot Polls are the polling feature.
- Unconfirmed create/reply IDs survive same-scope rerenders/retries, not full browser
  reload. Reload shows committed server data; users should check it before resubmitting.
  The original baseline lost root edit drafts on remote invalidation; `349ea30`
  fixes this and preserves the original version until explicit user review.
  Drafts are still discarded outside their verified editable window or after
  authority/event/identity changes; see the remediation report for tested boundaries.
- Revocation is not retroactive recall of already delivered content. The frontend hides
  state during disconnected/unverified access; healthy periodic checks bound detection.
- Production application builds and standalone browser tests ran. Container image
  builds/deployment, production credentials and external provider deliveries were not
  re-certified in this phase; Dockerfiles include the new types-only contract package.

Alternatives deliberately deferred: shared client socket lifecycle (couples Chat cleanup),
a durable topic event log/outbox (more operational work), fine-grained topic locks (more
complex pin/settings/authorization coordination), and multiple independent filter arrays
(risk contradictory entities). None is required to satisfy the tested local vertical slice.

## Running and verifying locally

Use repository README instructions. For the existing local integration environment:

```sh
docker compose -f docker-compose.chat-test.yml up -d --wait
node scripts/with-chat-test-env.mjs npm run db:generate
node scripts/with-chat-test-env.mjs npm run db:deploy
node scripts/with-chat-test-env.mjs npm run dev
```

Do not reseed an existing database. Staff: `http://localhost:3000/login`, existing demo
Alex account, then an event's **Live Operations**. Attendee: a separate browser profile,
`/events/:id/register`, open the Mailpit verification link in that same profile, confirm.
Submit a question, approve it as staff, reply as another participant, pin/unpin, edit and
observe re-review, reload, then delete. Audience controls are in **Question settings**.
The staff/attendee surfaces remain separate identities within the same event.

This phase stops at Topics integration.
