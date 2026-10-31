# OpsPilot Live Streaming & Watch Room — acceptance audit

Review started 30 October 2026; completed 31 October 2026. Scope: local RTMP/HLS integration and existing product regressions. The [updated audit task](opspilot-live-streaming-watch-room-acceptance-task.md), including its Approved Audit Addendum, defines the gate.

## Executive assessment

**Decision: FAIL.** The streaming-specific security and recovery checks passed, but the required existing-media upload/processing regression failed on two fresh uploads, with streaming both enabled and disabled. The gate requiring original OpsPilot workflows to remain usable is not met. Real FFmpeg → MediaMTX → authenticated NestJS HLS relay → Chrome decoding was exercised with two independently admitted viewers and staff; those successes do not override the failed regression.

**No P0 was found; one P1 blocks acceptance.** P1-01: existing real media processing reuses a correlation trace ID for multiple uniquely constrained domain events. Its completion transaction rolls back; the final failure transaction also rolls back, leaving PostgreSQL PROCESSING/90% while BullMQ is FAILED and derivative objects exist without registered variants. The affected media code predates streaming integration. This is a preexisting defect discovered by the acceptance regression, not evidence that streaming introduced it.

One P2 also remains: after a rejected prepare command, Refresh does not update the revision retained by “Retry preparing broadcast”. Retry receives another HTTP409. “Discard preparation retry” followed by a new prepare succeeds; this workaround was verified separately without changing the failing assertion. A P3 documentation mismatch describes the end-operation throttle incorrectly. An earlier provisional conditional-pass assessment was withdrawn when the supplemental real-upload check exposed P1-01.

This is a fresh evidence-based review by the same assistant that worked on the project, **not independent third-party certification**. No application code, existing test, schema, migration, lockfile or tracked runtime configuration was modified. Additional probes live in an ignored audit directory. The decision concerns readiness for the next local integration phase, not production deployment; no next phase or remediation was started.

## Baseline, authority and environment

- Destination: OpsPilot, branch `feat/streamops-chat-integration`, reviewed commit **`f68717bd1db24828191f4a276658130a94b63e5b`**. Working tree was clean before adding audit artifacts.
- Integration checkpoints: `8f13001` approved task/contracts, `76ecbbd` backend/media relay, `53f0806` Watch Room/recovery, `2cd658b` preferences/end retries, `f68717b` documentation. Expectations came from the approved integration task/addendum and plan; the migration report was treated as a claim to verify.
- Read-only source reference: Mudu Showcase `7bd9a2f`; its preexisting untracked audit files were not changed. Historical captured bundles/assets/research were not copied.
- Previous Chat reconnection remediation (`1ac03b`) and Topics remediation (`349ea30`, documented at `bf35f83`) were reviewed and subjected to fresh regressions. Prior failed acceptance reports are historical evidence, not an assumption that their repaired defects remain open.
- Host: macOS 26.6.2, x86_64, 64 GiB RAM; Node 22.20.0, npm 10.9.3, Docker Engine 29.2.1, PostgreSQL 17.11, Chrome 156.0.8078.74, local FFmpeg 9.0.1, pinned MediaMTX 1.21.3, isolated Redis 7.4.10-alpine. Measurements are single-host observations.
- New database `opspilot_live_audit_20261030_test` on localhost:5546; new Redis container `opspilot-live-audit-redis-20261030` on 6396; dedicated MinIO bucket `opspilot-live-audit-20261030` on the existing local storage service. Unique Mailpit messages were read, never cleared globally.
- Existing suites hardcode API/Web ports4100/3000 and MediaMTX1937/8890/9999. The owned development supervisor and absence of active publisher paths were verified before pausing it. Tests ran sequentially on those ports, using the isolated audit data. Mudu and unrelated Docker services were untouched.
- The audit wrapper generated local-only secrets in a mode0600 ignored file. Production deployment credentials were neither required nor copied. The fresh audit database was seeded once; no shared database was reset or reseeded.

### Evidence map

Sanitized [results.json](opspilot-live-streaming-evidence/results.json) records counts, measurements, failure reproductions and integrity checks. [SHA-256 manifest](opspilot-live-streaming-evidence/sha256.json) covers the exported evidence. Raw logs/probes remain in `.runtime/live-acceptance-20261030/`; raw traces and credentials are not exported.

| Evidence ID | Scope and source |
|---|---|
| U | 16 existing Jest suites / 105 tests, including broadcast validation, media URI handling, lifecycle/state helpers and existing services |
| S | 15 Chat/Topics normalized-state and draft tests |
| A | All six NestJS integration suites / 68 tests, real PostgreSQL/Redis; `apps/api/test/broadcast.e2e-spec.ts` contributes eight real media/security/recovery cases |
| B | Existing `e2e/broadcast.spec.ts`: three production-web Chrome workflows with real MediaMTX/FFmpeg and accelerated test-only30s grants |
| I | New independent probes: two default120s-ticket/authority tests, one two-event media-security test; real browser, APIs and database |
| F | New independent start-conflict probe: retained failing assertion, then repeat confirmation with separate verified workaround |
| C | Fresh API/worker/web Docker images; real container persistence, WebSocket/HLS and combined media-outage/API-restart cleanup probe |
| M | Migration preservation probe: 40 preexisting tables, five representative fixture rows, unchanged original-column counts/digests |
| R | Original 22 browser regressions with streaming disabled, plus separate Chat recovery and isolated UI suites |
| V | Supplemental existing-media real upload/worker/preview regression: retained failure, repeated with broadcasting disabled; real DB/Redis/MinIO consistency inspection |
| K | Generated-secret scans of local logs, MediaMTX output, compiled browser JS, tracked files and persisted ErrorReport fields |

## Requirements matrix

PASS means exercised at the stated scope; the evidence column distinguishes runtime proof from structural inspection. NOT VERIFIED entries below are explicitly noncritical local coverage gaps or predeclared out-of-scope deployment targets, not silently passed mandatory gates.

| ID | Expected | Actual behaviour and code evidence | Runtime evidence | Result |
|---|---|---|---|---|
| A01 | Preserve baseline, isolate data | Read-only implementation; fresh database/Redis/bucket; 320-file baseline manifest | Final integrity check | PASS |
| B01 | Separate event, operations and video | Existing StreamEvent/LiveSession retained; BroadcastSession is event child; no duplicate Room/User/login. `prisma/schema.prisma`, `broadcast.service.ts` | A/B: READY preparation, LIVE operations unchanged by video end | PASS |
| B02 | Additive migration/persistence | New broadcast tables, event revision and constraints only; `20261030010000_broadcast_sessions/migration.sql` | M/C: old data unchanged, new session survives API restart | PASS |
| B03 | One active session and idempotent commands | Event row lock, partial unique index, unique event/creator/operation ID; repeated end preserves target | A concurrent starts; I five concurrent ends all201; B lost start/end receipts | PASS |
| B04 | Select current session despite stale revisions | ACTIVE first; fallback immutable createdAt/id, not revision sorting; observation revision fence | A/I old session artificially higher revision cannot replace active; B stale snapshot/event | PASS |
| B05 | Preserve consistent end during external failure | Commit ENDED/revoke grants/cleanupPending before external kick; later reconcile | A actual control refusal; C media down + end + API restart + eventual cleanup | PASS |
| B06 | Prepare conflict can be retried after Refresh | `broadcast-panel.tsx:55–66` retains original expectedRevision as well as operation ID | F:409, Refresh,409; explicit discard/reprepare201 | **FAIL — P2-01** |
| C01 | Actual authorized RTMP ingest | Per-session path, hashed scoped grant, current DB authority; `broadcast.service.ts`, `mediamtx.service.ts` | A/B/I/C real FFmpeg publishers and MediaMTX paths | PASS |
| C02 | Real protected HLS bytes and Chrome decoding | Nest relay rewrites master/variant/init/segments; `media-relay.service.ts`, `live-player.tsx` | A resource bytes; B/I frames, advancing currentTime, screenshots | PASS |
| C03 | Two events stay independent | Grant/event/session binding; shared-workspace staff may legitimately operate both | I two simultaneous publishers, A-key→B denied before B becomes busy, B remains LIVE after ending A | PASS |
| D01 | Existing admission, even PUBLIC registration | Existing event verification/session; `watch-room.tsx`, `event-identity.service.ts` | B/I email admission; anonymous PUBLIC broadcast request401 | PASS |
| D02 | Video plus Chat, Topics and Polls | Existing feature panels reused within Watch Room, no duplicate interaction stores | B Chat send/moderate, Topic approval, Poll vote/results; I attendee Topic reply during actual playback | PASS |
| D03 | Interactions independent of video lifecycle | End video leaves LIVE event and active operations; video renewal retains sibling drafts | B publisher interruptions/end with interaction continuity; I draft through two default renewals | PASS |
| E01 | Existing staff Live Operations/SSE | Broadcast panel added alongside original operations controls | B/R staff controls, operational notes, manager/analyst live Poll updates | PASS |
| F01 | Detect publisher loss and recover | Reconcile actual media state; temporary interruption is not ENDED | B two real publisher kills/restarts, detection0.812–1.823s and recovery5.903–6.900s | PASS |
| F02 | Recover MediaMTX/API restarts | Persistent state, resubscription/REST snapshots; no fake LIVE under uncertain control | A/B/C actual outages/restarts and UNKNOWN during control failure | PASS |
| F03 | Viewer offline does not change global state | Player-local error/retry; global publisher remains LIVE | I browser offline6s then decoded recovery5.897s, staff snapshot remains LIVE | PASS |
| F04 | Old keys/commands cannot affect replacements | Key rotation/revocation; old end target retained; stale observations ignored | A/B/I retired key RTMP rejection, concurrent end, delayed snapshots, rotation | PASS |
| F05 | Default grant renewals remain usable | Default120s grants renew before expiry; accelerated setting test-only | I both viewers initial grant+at least two renewals, actual TTL119.948–119.990s, continued decode | PASS |
| G01 | Controls/autoplay/error recovery | Actual video controls; HLS retry/teardown; `live-player.tsx` | B injected autoplay denial and HLS503 then real decode; pause/unmute/volume; I fullscreen | PASS |
| G02 | Unmount/navigation cleans resources | Hls.destroy, listener/timer/media cleanup, release grant; actor/event keying | B three cycles; I five cycles no HLS after leave, stable settled listener/node counts and bounded grants | PASS |
| G03 | React development-only double-remount | Cleanup source reviewed; real browser probes used production standalone web | No dedicated StrictMode double-invocation experiment | NOT VERIFIED — noncritical coverage gap |
| H01 | Current staff authority, distinct attendee identity | Existing EventIdentityService and mutable authority locks, not JWT role claim alone | I same session through five roles; queued request sees committed demotion403; A attendee manage denied | PASS |
| H02 | Cross-workspace/event and WS isolation | Existing `/chat` gateway channel; event-bound ticket and fresh authorization | A independent staff/attendee sockets, wrong channel command denied, expired subscription; I foreign workspace403 | PASS |
| H03 | Direct RTMP/control access cannot bypass auth | MediaMTX callbacks required, protected control/relay, disabled unused protocols | A invalid callback/direct access denial; B new publisher while API down rejected; I wrong-event/revoked keys rejected | PASS |
| H04 | HLS ticket alone insufficient | Bound to principal/event/session/expiry plus fresh authenticated request | A master/variant/init/segment authorization; I copied viewer ticket403, cross-event403, expired viewer401 | PASS |
| H05 | Prompt revocation and safe cache/Origin | Current DB checks, private/no-store, no-referrer, origin validation | A publisher demotion kick within10s; I revocation at renewal clears private UI2.967s, untrusted Origin403 | PASS |
| H06 | Credential-safe diagnostics/resources | Internal relay key never returned; URI validation; redacted upstream errors | K no checked generated secret/raw query match; A persisted fault diagnostics; I rewritten playlist/internal key check | PASS (bounded scan scope) |
| H07 | Bounded relay failures | Slots reserved before await,64process/8principal,15s deadline,256KiB playlist/12MiB body cap | U guards; A actual503/refusal/timeout; B/I no normal-stream429 | PASS (not saturation/load certification) |
| H08 | Accurate documented command throttle | Start20/min, end inherits global100/min | Controller/app-module inspection versus migration report119 | **FAIL — P3-01** |
| I01 | Local performance within declared thresholds | Startup<=20s; detect<=10s; recovery<=25s; healthy revoke<=10s | B/I multiple startup/recovery samples below thresholds | PASS |
| I02 | Long soak, multi-instance, public TLS, large audience | Not delivered/required by approved local scope | Not exercised | NOT VERIFIED — outside local gate |
| J01 | Chat regression | Existing backend, gateway, normalized state and scroll/recovery UI | A/S/B/R; execution totals below | PASS |
| J02 | Topics regression | Existing moderation, replies, pin limit, version/draft/retry behaviour | A/S/B/I/R including real429 recovery and concurrency | PASS |
| J03 | Polls and Live Operations regression | Separate existing operational-session semantics, no rewrite | A/B/R manager+analyst updates, attendee vote and results | PASS |
| J04 | Auth, invitations, admission, event/workspace permissions | Existing systems reused | A/R login, public/restricted registration, email admission, revoke, readonly roles, event lifecycle | PASS |
| J05 | Existing real media upload/processing | Upload stores bytes, but completion/failure event traceId conflict strands the asset at90% | V two failures; queue FAILED, DB PROCESSING, two unregistered derivatives per asset | **FAIL — P1-01** |
| K01 | Type/lint/unit/state/integration/build | Existing checks unchanged | All check results below | PASS |
| K02 | Dependency review | npm production dependency advisory query | Configured mirror404; official registry query0 known vulnerabilities | PASS for npm production advisory query only |
| X01 | Safari/iOS/native HLS and OBS GUI | Implementation fallback/config reviewed; Chromium/FFmpeg are required local targets | No native-device/OBS GUI test | NOT VERIFIED — outside local gate |
| X02 | Recording/transcoding platform/CDN/multibitrate | Pre-approved exclusions; no extra feature added | Source scope review | DEFERRED |

## Domain, database and lifecycle assessment

The implementation preserves OpsPilot's domain. StreamEvent controls the business lifecycle; LiveSession continues to control operations/Polls; BroadcastSession controls video. ACTIVE/ENDED is a durable lifecycle, while WAITING/LIVE/INTERRUPTED/UNKNOWN describes observed media availability. A viewer-side error cannot end the broadcast or event.

The additive migration introduces BroadcastSession, BroadcastGrant and BroadcastPublisher, plus `StreamEvent.broadcastRevision`. Database constraints include one ACTIVE session per event, unique idempotency identity, valid lifecycle timestamps, positive/nonnegative revisions, grant hash format/expiry and foreign keys. The migration preservation probe replayed previous migrations in an owned disposable database, inserted representative user/workspace/event/Chat/Topic rows and compared all original table columns/counts/digests before and after. It passed for40 tables and five fixtures; this is stronger than merely successfully running migrate deploy, but not a test against every possible production dataset.

Commands lock the event row and check current mutable authority within the transaction. External MediaMTX calls occur outside the database transaction. End first commits the logical state, deletes grants and records cleanupPending. Reconciliation retries physical cleanup and fences stale observations by revision. The container experiment proved cleanup survives both an unreachable media server and API restart, then completes after media recovery. This is explicit eventual consistency, not a claimed atomic PostgreSQL/MediaMTX transaction.

Selection is ACTIVE-first with an immutable creation-time/id fallback. It does not select an old session just because its cleanup revision increased. Real tests forced the old row's revision above its replacement and verified selection. Five simultaneous ends all returned201; concurrent starts preserved one active row; lost acknowledgements did not create duplicate sessions. The remaining defect is in browser retry intent management, not database uniqueness or idempotent execution.

## Real media, Watch Room and recovery evidence

The actual FFmpeg source was generated locally (synthetic video plus sine audio):

```sh
ffmpeg -hide_banner -loglevel quiet -re \
  -f lavfi -i 'testsrc2=size=640x360:rate=24' \
  -f lavfi -i 'sine=frequency=440:sample_rate=44100' \
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
  -g 24 -b:v 800k -c:a aac -f flv \
  'rtmp://127.0.0.1:1937/live/<REDACTED_SESSION_AND_PUBLISH_KEY>'
```

The probes pass the runtime URL directly to a child process, without writing it into reports. MediaMTX source identity, authenticated HLS playlists/init/media bytes and Chrome decoded frames/currentTime were checked. HTTP200 alone was not counted as playback. See [desktop Watch Room](opspilot-live-streaming-evidence/watch-room.png) and [mobile Watch Room](opspilot-live-streaming-evidence/watch-mobile.png); screenshots were visually inspected as layout evidence, not used in place of decode assertions.

Two email-admitted browser contexts participated alongside the operator. The existing browser suite exercised actual video with Chat send/moderate, Topic submission/approval, Poll voting and live results. The independent sustained probe additionally posted a Topic reply from another attendee, kept an unsent Chat draft through two default-lifetime renewals, changed volume, paused/resumed and entered/exited fullscreen. PUBLIC registration still rejected an unauthenticated broadcast snapshot. Stopping video left business operations and interactions running.

Faults included real publisher termination/restart twice, actual MediaMTX restart, actual NestJS restart with publishing active, new publishing while auth was down, viewer offline, upstream503/refusal/timeout, lost prepare/end responses, end revision conflict and delayed state delivery. The independent container probe additionally combined end during media failure with an API restart before cleanup could finish. Old credentials were rejected on reconnect and terminal business completion retired video without affecting a separate event.

Autoplay refusal was deliberately injected to test its UI branch; subsequent playback used the real browser decoder. The HLS503 injection was similarly a fault stimulus, not the source of media success evidence. Initial no-publisher states and post-restart waiting/reconciliation were exercised in the lifecycle suites. No claim is made of zero rebuffering: renewal currently recreates the player, and already-buffered media cannot be recalled after authorization is revoked.

## Security assessment

| Boundary | Fresh verification and conclusion |
|---|---|
| REST identity | Existing staff session and attendee session used. Same staff session was changed in PostgreSQL through ADMIN, OPERATIONS_MANAGER, CONTENT_OPERATOR, ANALYST and VIEWER. ADMIN/OPERATIONS_MANAGER manage+publish; CONTENT_OPERATOR publishes but cannot prepare; ANALYST/VIEWER cannot publish/manage. A valid staff member of both events may use both. |
| In-flight revocation | A real request queued behind a held membership-row lock returned403 after the transaction committed demotion. No reliance on a cached JWT role. Attendee expiry injected at a fresh playback request denied the request and removed private video/Chat UI in2.967s; the other viewer continued. |
| WebSocket | Reuses authenticated `/chat` infrastructure with a broadcast channel. Independent clients receive authorized snapshots, reconnect and recover missed state. Wrong-channel commands, expired subscriptions and event mismatches were tested by the integration suite. REST remains the authoritative resync boundary. |
| RTMP/control | Direct invalid/retired/wrong-event keys rejected by actual FFmpeg/MediaMTX. Two legitimate simultaneous publishers verified event isolation. Rotation kills the previous publisher within the declared healthy-control bound. Control endpoints and callbacks require internal authentication; new RTMP publishing fails closed during API outage. |
| HLS | Every relay request needs the current principal and scoped grant. Master, variant, initialization and segment routes were tested. Copying A's ticket into B's admitted browser returned403; cross-event403; expired viewer401. Direct media origin did not bypass application authorization. |
| Browser/caching | Protected content private/no-store and no-referrer; untrusted Origin mutation403. URI rewriting prevents internal credentials or arbitrary upstream URLs escaping into public playlists. Publishing keys are deliberately visible only to current authorized staff who need to configure a publisher. |
| Secret review | No matching generated audit secret in scanned logs, MediaMTX stdout/stderr,41 compiled JS bundles or tracked files. Seven persisted ErrorReports were checked without exporting their content. Real upstream fault tests assert redacted persisted diagnostics. This is a bounded scan for known generated values/patterns, not a proof that every possible sensitive string is absent. No exposed real production credential was identified, so no rotation action was taken. |

The control/auth design is suitable for this single-host showcase. It does not prove resilience of a publicly exposed production edge. Local RTMP is unencrypted, production TLS was not tested, and credentials can appear in the local FFmpeg process arguments by design; no raw process command containing a key was included in evidence. In a control outage physical kick is eventually retried; denying future application requests and deleting grants does not erase bytes already buffered in a browser or instantly sever every transport while its control plane is unreachable.

## Performance and player resources

Workload: local640×360 H.264/AAC,24fps, video encoder target800kbps, two viewers plus optional staff preview; separate two-event isolation probe. The bitrate is an encoder setting, **not measured network throughput**. No broad load, CPU saturation, p95 or long-duration soak claim is made. Fresh Docker image builds overlapped the start of the supplemental sustained run, so these are acceptance timings rather than a controlled comparative benchmark.

| Measurement | Observed |
|---|---:|
| Browser startup, existing suite | 5.913s |
| Browser startup, independent default-TTL run | 7.934s |
| Publisher interruption detection, two samples | 1.823s /0.812s |
| Playback recovery after publisher restart, two samples | 6.900s /5.903s |
| Playback recovery after MediaMTX restart | 5.902s |
| Playback recovery after API restart | 3.947s |
| Viewer recovery after6s offline | 5.897s |
| Expired attendee's private UI removal | 2.967s |
| Actual default ticket lifetimes observed | 119.948–119.990s |
| Normal-playback429 | None observed |

Both independent viewers completed at least two renewals after their initial grant. Total grant responses9 and3 also include navigation/retry; they are not nine/three periodic renewals. The accelerated suite's9/7 responses likewise include recovery; it observed expected503/403 during faults but no429. Default-lifetime sustained playback had no recorded HLS error response before revocation.

After five leave/re-enter cycles with forced GC at comparable settled points, JS heap was6,894,252;6,933,680;6,927,892;6,928,112;6,930,728 bytes. DOM nodes stayed450 and listeners412. Requests to the old HLS source stopped after leaving. Playback grants stayed at4 in this two-viewer-plus-offline-recovery workload; one best-effort release was lost during offline and remained bounded by TTL. Before these cycles, the settled heap was8,597,432 bytes. Navigation resets renderer counters: these samples support bounded behavior during this experiment, not proof of leak freedom or total decoder/process-memory bounds. An unnormalized heap increase in the older measurement format was not labeled a leak; the additional GC-normalized run was used to clarify it.

The relay implements per-process64/per-principal8 in-flight slots,15s timeout,256KiB playlist and12MiB binary bounds. Guard/unit tests and real upstream failure tests passed. These are resource safeguards, not an audience-capacity benchmark. Native HLS/Safari, development StrictMode double-invocation, production proxy behavior, multi-instance coordination and long soaks remain unverified.

## Actual execution record

Commands below ran from the OpsPilot root. `A` is only a path abbreviation for `.runtime/live-acceptance-20261030`; the ignored `env.mjs` invokes the existing local test wrapper then overrides database/Redis/bucket and generated secrets for this audit. It refuses production mode. Log redirection omitted in this table does not change arguments or execution. The local wrapper must not be used against shared/production data.

```sh
A=.runtime/live-acceptance-20261030
```

| Exact command (using A above) | Observed result |
|---|---|
| `node "$A/env.mjs" npm run db:deploy` | PASS; fresh isolated database migrated |
| `node "$A/env.mjs" env DEMO_SEED_ALLOWED=true npm run db:seed` | PASS; only new audit database seeded |
| `npm run build` | PASS, NestJS + Next.js production builds |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test -- --runInBand` | PASS,16 suites105 tests,3.21s |
| `node --import tsx --test tests/chat-state.test.ts tests/topics-state.test.ts tests/topics-drafts.test.ts` | PASS,15 tests |
| `node "$A/env.mjs" npm run test:e2e --workspace=@opspilot/api -- --runInBand` | PASS,6 suites68 tests,71.591s |
| `node "$A/env.mjs" node scripts/check-broadcast-migration.mjs` | PASS,40 original tables/five fixtures preserved |
| `node "$A/env.mjs" npx playwright test --config=playwright.broadcast.config.ts --output=.runtime/live-acceptance-20261030/broadcast-results` | PASS,3 tests,2.1m |
| `node "$A/env.mjs" npx playwright test --config=.runtime/live-acceptance-20261030/playwright.config.ts` | PASS,2 independent tests,3.9m after diagnostic setup correction described below |
| `node "$A/env.mjs" npx playwright test --config=.runtime/live-acceptance-20261030/conflict.config.ts` | **1PASS/1FAIL**,33.8s; media-scope passed, retained prepare-conflict assertion failed |
| `node "$A/env.mjs" npx playwright test --config=.runtime/live-acceptance-20261030/conflict.config.ts --grep 'independent start conflict'` | **1FAIL** repeated; same failure, separate discard/reprepare workaround succeeds; not counted as another unique defect |
| `docker build --target api -f apps/api/Dockerfile -t opspilot-api:live-audit .` | PASS |
| `docker build --target worker -f apps/api/Dockerfile -t opspilot-worker:live-audit .` | PASS |
| `docker build -f apps/web/Dockerfile -t opspilot-web:live-audit .` | PASS |
| `node "$A/env.mjs" node "$A/containers.mjs"` | PASS after diagnostic sequencing correction below; API/worker/web ready, restart persistence, actual RTMP/HLS and durable cleanup |
| `node "$A/env.mjs" env BROADCAST_ENABLED=false E2E_PRODUCTION_WEB=1 npm run test:ui -- --trace=off --output=.runtime/live-acceptance-20261030/regression-results` | PASS,22 tests,7.0m |
| `node "$A/env.mjs" env BROADCAST_ENABLED=false CHAT_RECOVERY_PRODUCTION_WEB=1 npm run test:chat:recovery -- --trace=off --output=.runtime/live-acceptance-20261030/chat-recovery-results` | PASS,12 tests,1.5m |
| `node "$A/env.mjs" env BROADCAST_ENABLED=false npm run test:ui:isolated -- --trace=off --output=.runtime/live-acceptance-20261030/ui-results` | PASS,12 tests,24.5s; controlled/mock API boundary UI tests, supplemental to real backend evidence |
| `node "$A/env.mjs" npx playwright test --config=.runtime/live-acceptance-20261030/media-regression.config.ts` | **1FAIL**, READY assertion times out60s; real upload/transcode occurred but completion rolled back |
| `node "$A/env.mjs" env BROADCAST_ENABLED=false npx playwright test --config=.runtime/live-acceptance-20261030/media-regression.config.ts --output=.runtime/live-acceptance-20261030/media-disabled-results` | **1FAIL**, same unchanged assertion and cause on a new upload; not a second unique defect |
| `node "$A/env.mjs" node "$A/media-failure-evidence.mjs"` | Diagnostic exit0 means evidence collected; records **FAIL**, two failed assets, three stored objects/zero registered variants each, affected code unchanged since pre-streaming baseline |
| `npm audit --omit=dev --json` | Exit1: configured registry.npmmirror.com advisory endpoint404 NOT_IMPLEMENTED; not a vulnerability finding |
| `npm audit --omit=dev --registry=https://registry.npmjs.org --json` | Exit0;0 reported production npm vulnerabilities; excludes OS image CVEs |
| `node "$A/scan.mjs"` | PASS; generated-value/pattern scan, sanitized aggregate exported |
| `node "$A/env.mjs" node "$A/scan-database.mjs"` | PASS; seven persisted diagnostic rows, no matched generated secret/raw ticket query |
| `npm run broadcast:setup` | PASS; restored development MediaMTX credentials; no pending migrations, no seed/reset |
| `node scripts/with-broadcast-env.mjs --development npm run dev` | Restored as detached owned supervisor; web/API/worker ready |
| `node scripts/with-broadcast-env.mjs --development node "$A/check-restoration.mjs"` | PASS after correcting the new probe's control-client username from callback identity to relay identity; authenticated health/event/broadcast/control checks200 |
| `docker stop opspilot-live-audit-redis-20261030` | PASS; stopped only the audit-owned Redis, retained its state |
| `node "$A/export-evidence.mjs"` | PASS; all320 baseline implementation hashes and HEAD unchanged, sanitized evidence exported |

All final PASS commands exited0. Both prepare-conflict executions and both media-regression executions exited1 and remain failures. Initial setup failures were retained: the new diagnostic config first lacked an explicit project working directory, so no app/test started; fixed only the ignored probe config. The first container diagnostic restarted authentication immediately after spawning a replacement publisher, before its initial handshake; the corrected probe first verifies LIVE, then restarts the API to test the intended established-publisher scenario. Only diagnostic orchestration was corrected; application code, existing assertions and failed product assertions were not changed. These setup/sequencing failures are separate from the two product defects.

The final restoration diagnostic initially used the callback identity for a control request and was correctly denied. Reading `MediaMtxService.headers()` identified the required relay identity; correcting only the diagnostic yielded200. No production credential or application configuration was changed to bypass authentication. The original failed check log is retained locally.

### Regression assessment

| Area | Fresh result and boundaries |
|---|---|
| Chat | PASS in all API/state tests, two ordinary browser cases and enabled-streaming Watch Room workflow. Additional staff/attendee transient-DB, subscription, missed-history and retry suite recorded above. Scroll anchors, unread handling, bounded bursts, history, moderation and identity/event isolation exercised. |
| Topics | PASS in API/state and11 browser cases: submission, approval, replies, edit/delete, pins/settings, delayed snapshots, lost receipts, real429 recovery, draft/version handling and access switching. PostgreSQL concurrency coverage retained. Enabled-streaming approval and independent attendee reply passed. |
| Polls | PASS in manager/analyst two-context live updates and actual admitted Watch Room voting/results. Existing LIVE+ACTIVE operational-session rules retained. |
| Authentication/admission | PASS: staff login, guest verification and signout, restricted invitation/admission and revocation, current roles/queued demotion, cross-event/workspace denial. |
| Events/Live Operations/SSE | PASS: creation→configuration→ready→live→ended→archive golden flow, readiness/content/media attachment, operational updates, read-only analyst and mobile layouts. |
| Media | **FAIL** for real upload→processing→preview, with streaming enabled and disabled. Original seeded attachment/detachment and upload-dialog UI tests passed but do not exercise completion. Newly uploaded preview is NOT VERIFIED because no READY asset was produced. No Mudu upload migration was undertaken. |
| Audit/analytics/AI surfaces | Existing deterministic regression evidence passed; no paid/external model calls or production webhook targets used. |

## Findings and remediation order

### P1-01 — Real media completion and terminal failure both violate unique traceId

**Reproduction:** run the unmodified application against isolated PostgreSQL/Redis/MinIO, log in as the seeded operations manager, open existing `/streamops/media`, upload a synthetic three-second320×180 H.264/AAC MP4 (251,254 bytes), and wait for the real worker. The browser reports processing queued. Three worker attempts run; after60s the unchanged expected-READY assertion fails. Repeat on a fresh upload with `BROADCAST_ENABLED=false`: identical failure. No media fault was injected.

**Expected:** after the real object upload/transcode, atomically register variants and mark asset/job READY/SUCCEEDED; on terminal processing failure, persist FAILED and allow retry. **Actual:** both fresh assets remain PROCESSING/90%, job and third attempt remain PROCESSING in PostgreSQL, while BullMQ has exhausted all three attempts and is FAILED. No MediaVariant row is committed. MinIO contains the original, a520,900-byte preview MP4 and15,596-byte thumbnail for each asset. The original matches the local fixture SHA-256; the derivatives are unregistered storage objects. This is real database/queue/storage inconsistency, not merely a slow progress indicator.

**Established cause and affected files:**

- `prisma/schema.prisma:834`: `DomainEvent.traceId` is unique.
- `apps/api/src/media/media.service.ts:216,254–271`: the upload-completion request's traceId is persisted in `media.processing.queued` and forwarded into the job.
- `apps/api/src/media/media-processing.processor.ts:243–257`: the READY/variant transaction tries to create `media.processing.completed` with that same traceId; PostgreSQL rejects it and rolls back the transaction. Attempts1 and2 record the unique-constraint error.
- `apps/api/src/media/media-processing.processor.ts:436–497`: the third-attempt failure transaction tries to create `media.processing.failed` with that same traceId, rolling back even its FAILED status updates. Redis exhausts the job while PostgreSQL still says PROCESSING.
- `apps/api/src/domain-events/domain-events.service.ts:23–31` inserts each event directly. Current preview/retry endpoints require READY/FAILED respectively, and the UI shows Retry only for FAILED. `media-cleanup.processor.ts:117` only selects READY/FAILED for retention, so this PROCESSING state is not covered by that cleanup selection.

**Provenance:** SHA-256 comparison against pre-streaming commit `bf35f83` confirms the MediaService, MediaProcessingProcessor and DomainEventsService files are unchanged; that schema already has the same unique DomainEvent.traceId. Therefore this defect predates the integration. It nevertheless blocks the expressly required existing-media acceptance workflow. No claim is made that live-stream HLS failed, and no original shared upload was inspected or altered.

**Evidence:** both retained browser failures, [failed media screenshot](opspilot-live-streaming-evidence/media-processing-failure.png), and `mediaRegression` in the sanitized results (object sizes/hashes, DB statuses, queue state, same-trace queued event and source provenance). The original fixture hash is `25c468165dd2f6d2dc9d728369aa315642a31022fca3886628c04077fb2a0132`. Browser preview of the new upload could not be reached and is not claimed as passed.

**Recommended remediation before acceptance:** distinguish correlation identity from unique domain-event identity/idempotency. Permit distinct queued/completed/failed events in one trace while preventing duplicate publication for the same logical event; review webhook/outbox consumers before changing any uniqueness constraint. Ensure recording a diagnostic/outbox event cannot leave terminal queue failure looking actively PROCESSING. Add real PostgreSQL+Redis+MinIO success and terminal-failure/retry tests. Provide a separately authorized, non-destructive reconciliation path for already-stuck rows and stored derivatives; do not reset databases or delete uploads as a workaround. Rerun this real upload/processing/preview probe and affected outbox/media regressions after repair.

### P2-01 — Prepare retry retains a rejected revision after Refresh

**Affected code:** `apps/web/src/features/broadcast/broadcast-panel.tsx:55–66` (`begin`); compare `end` at69–85, which refreshes expectedRevision while retaining the original target. No source change made.

**Reproduction:** use an authorized operator and an event with an ended broadcast. Allow the UI to construct its prepare request. Advance the event broadcast revision in the isolated database before forwarding that real request (deterministic conflict injection, modeling a concurrent reconciliation/moderation update). The backend returns409. Click Refresh broadcast and await a verified current snapshot. Click Retry preparing broadcast. It sends the same clientOperationId **and the obsolete expectedRevision**, receiving409 again with zero active sessions. Repeat is stable.

**Expected:** a confirmed version rejection should allow an intentional retry against a newly verified revision while preserving idempotency and preventing a lost-success response from creating a second session. **Actual:** Refresh changes snapshot state but cannot change retained `start`; `const intent = start ?? {...snapshot.revision}` reuses the entire rejected intent.

Initial reproduction: statuses `[409,409]`, submitted revisions `[3,3]`, current revision4. Independent confirmation: `[409,409]` with revisions `[2,2]`; current4. Clicking **Discard preparation retry**, then Prepare sends revision4 and returns201, creating exactly one active session. [Conflict screenshot](opspilot-live-streaming-evidence/start-conflict.png) and sanitized JSON retain the evidence. The assertion expecting the second attempt201 still fails; the workaround does not convert it into a passed test.

**Severity rationale:** moderate operator recovery defect with a visible, verified workaround; normal start, lost-response retry, concurrent uniqueness and replacement isolation pass. It does not grant unauthorized access or corrupt data, and does not permanently block preparing a broadcast. It therefore remains P2 rather than a P1 gate failure.

**Recommended fix:** distinguish a known409 rejection from an uncertain response. After refreshing/confirming the current context, update the revision for the intentional retry while retaining or resolving the operation identity safely. Preserve existing behavior when the backend may already have committed; never retry an end against a replacement target. Add a browser regression for Refresh→retry after start conflict alongside existing lost-receipt tests. Do not remove the conflict check or silently create a fresh operation on every error.

### P3-01 — End-operation rate limit is misstated

**Affected documentation:** `docs/integration/live-streaming-migration-report.md:119` claims prepare/end20/min. **Actual source:** start has `@Throttle(...20...)` at `broadcast.controller.ts:54`; end at66–80 has no override and inherits global100/min from `app.module.ts:37`.

**Reproduction/evidence:** compare those declarations; no request flood was needed. The end route still has a rate limit, so this is an inaccurate operational contract rather than an unprotected endpoint or established exploit. **Recommended fix:** agree the intended policy and align documentation (or deliberately change/test the route limit in a separate authorized fix). No runtime100-request boundary test was performed.

### Noncritical coverage/deployment limitations

- No dedicated development StrictMode double-mount run. Production unmount/navigation and real decoder cleanup were instrumented; add a dev-mode lifecycle probe when addressing player changes.
- Safari/iOS/native HLS, actual OBS GUI, TLS/reverse-proxy deployment, multi-instance behavior, long soak, large audience, CPU/throughput ceilings and OS-image vulnerability scanning are NOT VERIFIED. These are predeclared outside the mandatory local gate, not passed by implication.
- Ticket renewal can reinitialize playback and rebuffer. Local success proves recovery, not seamless uninterrupted rendering. Buffered bytes are not revocable.
- In-flight relay limits are per process, reconciliation is periodic/bounded, and physical media cleanup is eventually consistent. A public deployment needs its own capacity and failure-domain validation.
- Drafts survive ordinary video renewal; full page refresh or failed admission revalidation can discard unsubmitted text under the agreed scope. Persisted Chat/Topics were verified after reload/recovery.

Prioritize P1-01 and its real upload/terminal-failure regression before acceptance; then P2-01 with its focused browser regression, followed by P3-01. Track the noncritical environment/device tests before widening deployment claims. No rewrite or unrelated feature work is recommended.

## Handoff and final gate

All **320** tracked implementation/test/configuration files in the pre-review SHA-256 manifest still match, and HEAD remains `f68717bd1db24828191f4a276658130a94b63e5b`. Mudu remains at `7bd9a2f` with its original preexisting untracked audit materials. New deliverables are this report, the updated task and sanitized evidence; no implementation commit was created and these audit deliverables remain uncommitted for review.

Original development operation is restored at `http://localhost:3000` and API4100 using `opspilot_chat_test`, Redis6381 and development MediaMTX credentials. Web/API readiness, staff login, event listing, broadcast snapshot and protected MediaMTX control all returned200; background worker readiness was observed, broadcasting enabled and no active media paths left by the audit. Only the owned audit Redis was stopped. Disposable audit database/bucket, failed media fixtures and ignored diagnostic scripts/logs remain available for reproduction; no shared upload, bucket, volume or database was deleted/reset/reseeded.

Fresh successful checks total105 unit tests,15 state tests,68 API integration tests and52 browser cases (the last count includes12 controlled-boundary UI cases, separately identified from real backend cases). Two additional unique browser scenarios failed and were each reproduced: prepare-conflict retry and real media completion. Counts do not turn the failed scenarios into passes or count their repeated confirmation as new coverage.

Streaming-specific real media, security, persistence, lifecycle/recovery and interaction gates passed. The required existing-media regression did not: **FAIL**, blocked by P1-01, with P2-01 and P3-01 also open. Do not approve the overall next-phase gate until P1-01 is repaired and the failed workflow rerun successfully. The audit ends here: no defect fix or next-module migration is included.
