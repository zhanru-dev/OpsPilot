# StreamOps live streaming integration report

30 October 2026. Scope: real RTMP/HLS video inside OpsPilot, following the
[updated task](live-streaming-integration-task.md) and [pre-implementation contracts](live-streaming-integration-plan.md).
Media Library migration is excluded.

## Baselines and provenance

Destination: OpsPilot, branch `feat/streamops-chat-integration`, initially clean at
`bf35f83`. Source: Mudu Engineering Showcase `7bd9a2f`, unchanged throughout this
work, including its pre-existing untracked streaming audit/evidence. No source
repository commits, research files, captured bundles, proprietary assets, branding
or old Pages Router screens were copied into OpsPilot.

Source fixes were verified by reading current code and recorded remediation:
LS-01 session selection (`bf0b5c0`) selects ACTIVE first, then immutable creation
order, rather than mutable revision; LS-02 (`c569af8`, finalized refusal tests
`5c205bc`) removes callback credentials from transport-error URLs. This is not a
claim that the Mudu test suite was freshly rerun. The destination has new tests
of those failure classes and a separate credential-safe error-report boundary.

| Source implementation reference | Destination and adaptation |
|---|---|
| `apps/api/src/live/live.service.ts`, `state.ts` | `apps/api/src/broadcast/broadcast.service.ts`: lifecycle/revision concepts, rewritten for StreamEvent, existing principal locks, staff/attendee policy and PostgreSQL constraints |
| `apps/api/src/live/mediamtx.ts` | `broadcast/mediamtx.service.ts`, `media-utils.ts`, `media-relay.service.ts`: pinned control API, bounded authenticated relay, same-origin redirect validation |
| `apps/web/src/features/live/useLive.ts`, `state.ts` | `features/broadcast/use-broadcast.ts`: current authenticated gateway ticket channel and verified REST snapshots |
| `apps/web/src/features/live/LivePlayer.tsx` | `features/broadcast/live-player.tsx`: effect ownership, hls.js cleanup, credential renewal, pagehide release and bounded retries adapted to existing API/cookies |
| Source live workspace | New OpsPilot BroadcastPanel and App Router Watch Room composed with existing ChatPanel, TopicsPanel and AttendeeLivePolls |

No new User/Room/Auth tables, no second application shell, no copied Prisma
migrations and no replacement Chat/Topics/Polls implementations.

## Domain, persistence and concurrency

`StreamEvent` is the authoritative business scope. `LiveSession` remains the
operational timeline and Poll container. Preparing or ending a video session does
not transition either business object. READY events can rehearse video; Polls
still require the existing LIVE + ACTIVE operational session rules. Completing,
archiving or cancelling the business event denies subsequent protected video
requests and retires its active broadcast through reconciliation.

Migration `20261030010000_broadcast_sessions` adds:

- `StreamEvent.broadcastRevision` with a nonnegative default zero.
- `BroadcastSession`: event and creator FKs, idempotency UUID, immutable createdAt,
  ACTIVE/ENDED lifecycle, WAITING/LIVE/INTERRUPTED/UNKNOWN observed availability,
  per-row revision, first-live/end/check times and durable cleanup intent.
- `BroadcastGrant`: only a SHA-256 hash of the random opaque credential; kind,
  expiry, server-verified principal JSON and canonical principal hash.
- `BroadcastPublisher`: unique media connection ID to grant mapping.

A partial unique index permits at most one ACTIVE broadcast per event. Lifecycle,
revision, grant expiry/hash and principal structure checks supplement Prisma
relations. Event FOR UPDATE locks serialize start/end/key rotation and current
permission checks. Start is idempotent on (event, creator, clientOperationId), and
end retries target the original session ID. Both use expected event revisions.
An old end receipt cannot stop a replacement session. After an end conflict,
Refresh/Retry uses the latest verified event revision while retaining that
original target ID; it does not repeatedly submit an obsolete revision.

Network calls never hold a database transaction. Reconciliation observes media
outside the transaction, then applies it only if the captured session revision
still matches. ACTIVE-first selection and createdAt/id ordering prevent delayed
cleanup of an older session from replacing the current one in the UI. Ending
commits ENDED, grant revocation and cleanupPending before attempting media work.
Pending cleanup survives API restart. Failure of the control API is UNKNOWN,
not proof of disconnected ingest. Batches are bounded to 20 sessions, four network
observations at a time, on a 2s single-process loop.

All prior migrations remain intact. A disposable database built from the exact
preceding migrations verified all original columns and row-count/digest equality
for 40 tables, with five explicit user/workspace/event/chat/topic fixtures; the
new revision defaults to zero. The existing local development database received
only this additive migration, without reseeding. Its initial pre-migration digest
probe failed because a PostgreSQL metadata array needed a text cast, so no
before/after digest claim is made for that database. The SQL contains no update,
delete, drop or rewrite of prior data; the separate migration probe is reproducible.

## Permissions and transport

Every operation uses EventIdentityService and current database authority, not an
indefinite JWT role claim. It checks staff login/session/membership and the event's
workspace, or attendee session/registration/admission and the exact event.

| Principal | Read metadata / watch READY or LIVE | Prepare/end | Publish |
|---|---|---|---|
| ADMIN, OPERATIONS_MANAGER | yes | yes; start only READY/LIVE | yes |
| CONTENT_OPERATOR | yes | no | yes |
| ANALYST, VIEWER | yes | no | no |
| Admitted attendee | yes | no | no |
| Unauthenticated or another event's attendee | no | no | no |

Staff retain historical metadata read access after the business event ends, but
cannot watch or publish. The healthy publisher-revocation target is <=10s in the
local test workload; permission is rechecked every protected resource and during
publisher reconciliation. During control/auth failure the API fails closed for
new access, but physical ingest termination cannot be promised until the control
plane recovers. Already delivered/buffered media cannot be recalled.

RTMP H.264/AAC -> MediaMTX 1.21.3 -> fMP4 HLS -> authenticated Nest relay ->
hls.js 1.7.3 / native-HLS fallback. MediaMTX authentication applies to publish,
read and control; there are no anonymous exclusions. Publishing keys expire
within four hours or the staff session lifetime, whichever is earlier. Rotation
invalidates only the same login's prior publisher key. Playback grants default
to 120 seconds and are bound to both the broadcast and the verified browser
principal. A copied URL alone does not authorize another browser. Tests shorten
the lifetime to 30s only in NODE_ENV=test.

The relay authorizes master playlists, variant playlists, initialization files
and segments before fetching, and rechecks before delivering. It rewrites every
media URI back to the protected API; only a validated media-reader UUID can be
forwarded in upstream queries. Traversal, absolute URLs and unexpected query
parameters fail closed. Responses use private/no-store and no-referrer. A
64-request process limit and eight-request principal limit reserve capacity
before awaiting work; all exits release slots. Playlists are capped at 256KiB,
binary resources at 12MiB, with backpressure and a 15s upstream deadline.

Endpoint throttles preserve the application's global protection: HLS6000/min,
media callbacks12000/min, prepare20/min, end100/min (the global default),
and playback grants120/min. Successful
playback was exercised across real rate-limit windows with two viewers plus staff
preview, with zero HLS429 responses. An application relay intentionally trades
bandwidth/database work for a straightforward current-permission boundary.

Pinned primary references: [MediaMTX configuration](https://github.com/bluenviron/mediamtx/blob/v1.21.3/mediamtx.yml),
[tagged authentication implementation](https://github.com/bluenviron/mediamtx/blob/v1.21.3/internal/auth/manager.go).

## Frontend and coexistence

Staff BroadcastPanel is a separate section inside the existing Live Operations
screen. The admitted `/events/[id]/watch` route composes the existing interactions
with the player; the existing confirmation page links to it. No extra login is
introduced. PUBLIC is a registration policy, not anonymous playback permission.

The existing `/chat` Socket.IO namespace gets a ticket-bound broadcast channel;
Chat and Topics command handlers are not installed on broadcast connections.
Snapshots carry event/revision/authority but no credentials. The client treats
socket snapshots as hints, fetches authoritative REST snapshots, rejects older
revisions, fences stale requests, and clears private state on actual access loss.
Periodic current-auth checks and fresh one-use socket tickets repair transient
failures without a page reload. OpsPilot operational SSE continues unchanged.

Each player effect owns its Hls instance, requests, listeners, timers and grant.
Cleanup destroys Hls, aborts requests, clears media src and releases the ticket;
pagehide also handles full document navigation, with TTL as fallback for a lost
keepalive. Persisted-page restoration starts fresh ownership. Publisher controls
are keyed to verified authority/session so old credentials disappear when
permission or session identity changes. Native video controls supply play/pause,
volume, mute and fullscreen. Autoplay rejection gets a visible Play instruction.

Renewal currently recreates the player with a fresh grant, so a brief rebuffer
is possible. User pause preference is retained across player renewal. Interrupted
video and normal grant renewal do not recreate the sibling interaction panels.
A full page reload retains persisted interactions but does not promise to retain
unsubmitted drafts (the previously accepted application boundary).

A real restart test found that open SSE connections could delay API shutdown and
Prisma was disconnecting before in-flight work. The API now closes persistent
HTTP connections on shutdown; Prisma disconnects at application shutdown after
module/gateway cleanup and HTTP disposal. This is an essential startup/recovery
integration change, not a replacement of SSE.

## Verification record

Environment: macOS x86_64, Node22.20.0, npm10.9.3, Docker29.2.1, FFmpeg9.0.1,
Next16.4.3, actual Chrome156.0.8078.74, PostgreSQL at5546, database
`opspilot_broadcast_test`, Redis6394, isolated bucket `opspilot-broadcast-test`,
MediaMTX RTMP1937/HLS8890/control9999. No shared database reset, source service
shutdown, user upload deletion, hosted deployment or external credentials.

| Executed command | Actual result |
|---|---|
| `npm run broadcast:test:setup` | PASS: dedicated database, Redis and authenticated MediaMTX available; existing databases not reseeded |
| `npm run test:broadcast:migration` | PASS: original columns/counts/digests unchanged across 40 tables; new revision default 0 |
| `npm run test -- --runInBand` | 16 unit suites, 105/105 passed |
| `node --import tsx --test tests/chat-state.test.ts tests/topics-state.test.ts tests/topics-drafts.test.ts` | 15/15 passed |
| `node scripts/with-broadcast-env.mjs npm run test:e2e --workspace=@opspilot/api -- --runInBand` | 6 real API suites, 68/68 passed, 66.1s; includes Broadcast, Chat, Topics, app, attendee and restricted access |
| `npm run test:broadcast:api` | Final extended Broadcast API suite 8/8 passed, 33.4s; includes actual retired publisher reconnect rejection |
| `npm run test:broadcast:browser` | 3/3 passed, 2.1m; real Chrome, FFmpeg, MediaMTX, PostgreSQL and independently admitted contexts |
| `node scripts/with-broadcast-env.mjs env BROADCAST_ENABLED=false E2E_PRODUCTION_WEB=1 npm run test:ui` | 22/22 real product browser regressions passed, 6.9m |
| `node scripts/with-broadcast-env.mjs env BROADCAST_ENABLED=false CHAT_RECOVERY_PRODUCTION_WEB=1 npm run test:chat:recovery` | 12/12 passed, 1.5m |
| `node scripts/with-broadcast-env.mjs env BROADCAST_ENABLED=false npm run test:ui:isolated` | 12/12 passed, 28.2s; isolated UI tests are supplementary to the real integration suites |
| `npm run typecheck` / `npm run lint` | Both passed after final production changes |
| `npm run build` | Nest and Next production builds passed; `npm run build --workspace=@opspilot/web` repeated successfully after final player/end-retry changes |
| `docker build --target api -f apps/api/Dockerfile -t opspilot-api:broadcast-integration .` | PASS |
| `docker build --target worker -f apps/api/Dockerfile -t opspilot-worker:broadcast-integration .` | PASS |
| `docker build -f apps/web/Dockerfile -t opspilot-web:broadcast-integration .` | PASS, rebuilt with final production source |
| `node scripts/with-broadcast-env.mjs node scripts/check-broadcast-containers.mjs` | PASS: all three images start; actual RTMP/protected HLS, database session identity, persisted Chat and new Chat socket survive API container restart |
| `node scripts/with-broadcast-env.mjs node scripts/check-broadcast-logs.mjs` | PASS: 32 local log sources including MediaMTX, seven generated secret representations checked; no raw matches or 64-hex ticket/password query values |

The container probe uses production-built images with isolated test environment
settings; it is not a public TLS deployment test. The 68-test API total includes
the eight Broadcast cases; the subsequent focused run is not eight additional
unique cases. Local raw logs are under ignored `.runtime/broadcast/`. Only
credential-free measurements are retained in the versioned evidence file.

Preliminary runs are not silently counted as passing: the initial browser run
found the misplaced panel, restart tests found shutdown ordering, and
full-navigation teardown exposed missing pagehide cleanup. Those defects were
fixed and rerun. Final coverage also verifies preserving pause/volume preferences
and retries after a concurrent end revision conflict. One initial Topics API
notification test exceeded its 5s budget; the unchanged focused 16-test suite and
subsequent full API run passed. The isolated Polls fixture initially counted the
new broadcast ticket POST as a Poll mutation: it now explicitly denies that
unrelated ticket route, matching its existing Chat/Topics fixture. Its Polls
assertions were not weakened. No test was deleted or changed to hide a failure.

### Security, recovery and regression evidence

- Real API tests check concurrent starts, a single ACTIVE database row, retry
  identity, current staff/attendee access, cross-event/workspace denial and
  independent authenticated socket delivery. Broadcast sockets cannot invoke
  Chat operations.
- Actual RTMP/HLS tests check playlist, variant, initialization and media bytes,
  direct unauthenticated MediaMTX denial, copied tickets with another principal,
  expiry, publisher role revocation and old keys after replacement. A control
  connection refusal leaves the end committed and cleanup durable; restored
  control finishes cleanup without changing current session selection.
- The fault test issues real upstream 503, refused-connection and 15s timeout
  requests, and checks safe 503 responses and persisted ErrorReport sanitization.
  Browser tests stop the real API process and MediaMTX container. New RTMP ingest
  is denied while the authentication API is unavailable.
- Watch Room tests use two separate email-admitted attendee contexts, real decoded
  video frames/time progression, Chat delivery/moderation, Topic approval and Poll
  voting. They cover renewal, duplicate/delayed snapshots, old REST responses,
  lost start/end receipts, replacement identity, page reload, cross-event
  navigation denial, autoplay rejection and bounded recovery from media failures.
- Chat: both ordinary browser scenarios and all 12 staff/attendee fault-recovery
  scenarios pass, including real PostgreSQL timeout and session revocation.
- Topics: persistence/concurrent moderation and real browser approval/replies/
  pin/edit/settings, lost receipts, HTTP429 retries, stale parents, draft/version
  handling and identity switching pass.
- Original OpsPilot: staff login/role surfaces, event golden flow, registration,
  restricted invitation/revocation, Live Operations/Poll voting and media/webhook/
  analytics assurance regressions pass. The simultaneous video test leaves the
  business event LIVE and Poll/Chat/Topics usable after video ends.

No unresolved P0/P1 defect was identified within the implemented local scope.
This is implementation verification, not a claim of an independent security audit
or certification. Native Safari/iOS, production TLS, prolonged load and multiple
API replicas remain outside the evidence.

### Local performance and resource observations

The [sanitized measurements](live-streaming-local-observations.json) retain actual
timings and counters. Final workload: FFmpeg H.264/AAC, 640x360, 24fps, target
800kbit/s video; two independent attendee viewers plus staff preview on localhost.
The thresholds below were recorded in the plan before testing.

| Observation | Final measured result | Predeclared bound |
|---|---|---|
| First decoded playback | 6,915ms | <=20,000ms |
| Publisher interruption detected, two samples | 1,328ms; 816ms | <=10,000ms |
| Playback after publisher reconnect, two samples | 6,900ms; 5,895ms | <=25,000ms |
| Playback after actual MediaMTX restart | 5,901ms | <=25,000ms |
| Playback after actual Nest restart | 3,945ms | <=25,000ms |
| Playback grants issued per attendee | 9; 7, including recovery; both pass initial + two renewal assertion | >=3 each |
| HLS429 responses | 0 | no exhaustion under declared workload |
| Active playback grants after three navigation cycles | 2, 2, 2 for staff + one attendee | no cumulative reader growth |

Decode timing requires advancing currentTime and decoded frame counters; it is
not glass-to-glass latency. Fault-window HLS503/403 responses are expected and
recorded, not discarded from evidence. Desktop1280x720 and mobile390x844 Watch
Room screenshots were visually inspected; mobile overflow assertion passed.
Native pause, unmute and volume0.4 survive player recreation; playback then
resumes and decodes real frames. Full navigation stops old HLS requests before
returning, and expired admission removes media and private interaction panels.

Over the final 53.1s sampled interval with navigation/recovery, Chrome JS heap was
17,830,324 -> 26,362,968 bytes, listeners1493 ->1444, documents30 ->17, nodes1244
->1807. Natural GC and document replacement make these noisy point observations;
the heap increase is recorded, not asserted to prove or disprove a leak. A prior
passing run fell from17,884,152 to16,771,388 bytes. Three navigation cycles and
bounded grants/requests verify teardown behavior; they are not a long soak test.
Navigation resets renderer task counters, so these samples do not establish a
valid sustained player CPU percentage or React render-duration benchmark.

A supplementary point sample during the preceding passing browser run measured
API RSS246,904KiB (~241MiB), ps CPU12.0%, MediaMTX38.55MiB and Docker CPU2.02%.
These different CPU sampling windows are not directly comparable or peak values.
The observed recovery cost is seconds of segment acquisition/decoding; ticket
renewal recreates MediaSource and can rebuffer. No production throughput or
capacity claim is inferred from this small local workload.

## Local operation and FFmpeg verification

Existing integration development data:

```sh
npm run broadcast:setup
npm run broadcast:dev
```

At handoff the owned development service was restored on localhost3000/4100
against the existing `opspilot_chat_test` data. API readiness, web login, Worker
readiness, real staff authentication and an enabled event Broadcast snapshot
were checked. All 13 migrations are applied; no seed/reset was performed. The
ignored supervisor PID is `.runtime/broadcast/development.pid`. Avoid starting
another copy while it is running. Video remains waiting until an authorised
publisher connects; no publisher is left running by the test fixtures.

For isolated fixtures, stop the owned application process first, then:

```sh
npm run broadcast:test:setup
npm run build
npm run test:broadcast:migration
npm run test:broadcast:api
npm run test:broadcast:browser
```

Development and tests share local ports and a single local MediaMTX service, so
run them sequentially and re-run the appropriate setup to select the matching
generated secret. The wrappers refuse NODE_ENV=production, keep keys in ignored
0600 files and never seed an existing database. Do not print Docker's resolved
environment/configuration. Defaults leave streaming disabled.

Sign in at localhost3000, open an event's Live Operations, choose Prepare
broadcast, expand Publisher connection and generate a key. OBS: custom RTMP
server `rtmp://127.0.0.1:1937/live`, generated stream key, H.264 and AAC. FFmpeg can
produce a disposable test pattern without placing the key in shell history or a
committed file:

```sh
printf 'Paste the generated stream key (hidden): '
read -r -s OPS_BROADCAST_KEY
printf '\n'
ffmpeg -hide_banner -loglevel quiet -re \
  -f lavfi -i 'testsrc2=size=640x360:rate=24' \
  -f lavfi -i 'sine=frequency=440:sample_rate=44100' \
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -g 24 \
  -c:a aac -f flv "rtmp://127.0.0.1:1937/live/${OPS_BROADCAST_KEY}"
unset OPS_BROADCAST_KEY
```

Stop FFmpeg with Ctrl-C and observe interruption, then reconnect with the same
unexpired key. As with ordinary RTMP tooling, the publisher process argument can
be inspected by the local operating-system user; this is a local-only example,
not a protected credential-delivery mechanism for an untrusted host. Logs are
suppressed because FFmpeg errors may echo its output URL.

An attendee uses the existing email verification/admission and Enter Watch Room
link. Separate browser profiles provide independent identities. Ending video
must leave Chat/Questions/Polls operational; completing the business event is a
separate existing action.

## Limitations and alternatives

- Verified local single API/MediaMTX instance only; no production capacity, SLA,
  soak, HA, multi-region or multiple-replica guarantee. Process slot counters and
  reconciliation leadership are not distributed.
- Native Safari/iOS HLS is implemented but NOT VERIFIED without those actual
  browsers/devices. Chromium decoding is the declared mandatory local gate.
- FFmpeg real H.264/AAC publication is exercised; OBS configuration is documented,
  not a claim that the OBS GUI was manually operated.
- No transcoding, ABR ladder, recording/replay, DVR, CDN or WebRTC. Encoder codecs
  and keyframe cadence must match browser HLS support. Latency is seconds, not
  sub-second. No Media Library migration.
- Ticket renewal can briefly rebuffer. A custom Hls loader that rotates credentials
  without replacing MediaSource is a possible later improvement; native HLS and
  identity revocation make its correctness substantially more complex.
- If the attendee session cannot be revalidated during a full API outage, the
  Watch Room clears its private panels and restores persisted content after
  recovery. Unsubmitted drafts are not guaranteed across that access reset or a
  full page reload; ordinary video renewal/interruption retains sibling panels.
- Infrastructure failure denies new authorization. Physical termination needs a
  reachable media control plane; already buffered data remains playable briefly.
  Pending cleanup is durable and resumes after restart.
- Expired abandoned grants are deleted in bounded batches. Release during abrupt
  browser death is best effort; TTL and the per-principal grant limit bound it.
- A managed CDN with signed cookies could reduce relay cost, but would need an
  explicit revocation/caching policy. WebRTC changes the media architecture and
  is outside the accepted RTMP/HLS scope.

## Checkpoints

`8f13001` approved task/contracts; `76ecbbd` database/backend/media boundary;
`53f0806` Watch Room, player and first complete fault/recovery evidence;
`2cd658b` final implementation/tests, player preferences and conflict-safe end
retry, plus reproducible container and log probes. Final measurements and this
report are committed in a separate documentation checkpoint on
`feat/streamops-chat-integration`. Mudu remains at `7bd9a2f` with its original
working-tree state. Live Streaming is the final module of this phase; no Media
Library migration has started.
