# OpsPilot — Final Independent Full-system Engineering Acceptance Audit

Approved task, revised 2026-11-03. Execute autonomously through all safe stages, then stop. This is an independent audit, not a development iteration. Prior reports are leads to verify, never proof of a PASS.

## 1. Role, objective and scope

Act as Principal Software Engineer, Full-stack Architect, Security Engineer, Performance Engineer, SRE and QA Lead. Determine what actually works, is broken or unverified; identify regressions and security/data-integrity risks; evaluate domain coherence and credible engineering portfolio readiness separately from production readiness.

OpsPilot is authoritative. Inspect its actual Next.js App Router/React/TypeScript frontend, NestJS API, Prisma/PostgreSQL, session/admission/RBAC, WebSocket/SSE, MinIO/S3, BullMQ/Redis/FFmpeg, MediaMTX/RTMP/HLS and Docker tooling. Do not assume technology names prove implementation.

Cover original workflows plus Chat, Topics/Q&A, unified Permission Management, Media Library and Live Streaming. Permission Management means the actual shared staff/attendee/session/current-membership and event capability contracts, not an assumed migration of Mudu's complete permission administration UI. Explicitly inventory independently integrated, reused, partial, unsupported and previously deferred capabilities. No duplicate Room/User/Workspace/Login system is expected.

Product journey: select supported Workspace → create/prepare StreamEvent → Launch Control → registration/admission → prepare media → prepare broadcast → actual live video → Chat/Topics/Polls → Live Operations → completion → available operational review/analytics. Do not invent deferred registration, role-administration, recording, replay/CDN or attachment features.

## 2. Baseline and safety

1. Record exact commit, branch, dirty tree, relevant integration/fix commits and active local services before tests. Expected prior checkpoint is 516f2a3; re-read actual Git state.
2. Read README, architecture, strategy, threat model, implementation contracts, prior acceptance and remediation reports. Identify any unresolved P0/P1 without trusting completion claims.
3. Preserve application source, Prisma migrations and existing tests. Prefer a separate checkout/worktree. Compare application files against the reviewed commit again at the end.
4. May add audit documents, synthetic fixtures, temporary diagnostic tests, bounded fault harnesses and sanitized evidence. Keep additions to tests/harnesses separate from reviewed application source. Record every address/config adaptation; never weaken assertions, disable authorization or substitute mocks for mandatory services.
5. Never reset shared DBs, delete user media, rotate live credentials, clear shared Mailpit, or modify production resources. Localhost is not evidence of disposability.
6. Database/bucket/Redis logical namespaces do not authorize stopping their shared server. Service restart/outage experiments require whole instances owned by this audit. Otherwise inject only connection-/transaction-/fixture-scoped faults and document limitations.
7. Use exclusive test ports/resources, synthetic identities and private storage. Keep credentials and authenticated traces out of reports. Do not dump environments, bearer URLs or publisher keys.
8. Stop only audit-owned services at completion, retain useful evidence, and verify original development services remain available. No production deployment or automatic remediation.

## 3. Establish finite acceptance gates and evidence

Before runtime testing, create requirement IDs, expected behavior, criticality and evidence plans. Critical gates below are mandatory. Bounded non-critical omissions may support CONDITIONAL PASS; previously deferred capabilities are DEFERRED, not automatically defects. Critical NOT VERIFIED means FAIL.

Classify proof as static, unit, component/mock, real infrastructure, browser E2E, performance or manual. Record run IDs, commands, source revision, environment, data volume, elapsed time, first failures, reruns, skipped/filtered tests and blockers. Deduplicate test counts. Never combine separate module successes into proof of one complete journey.

Use controlled workloads: two or more independent browser contexts; moderator/participant/attendee/read-only/foreign-scope identities as relevant; bounded concurrent requests; finite chat/history and upload datasets. Record limits and stop conditions before load/fault experiments. No uncontrolled load testing.

## A. Repository and architecture inventory

Inspect routing, features, Nest modules/services, shared contracts, API clients, state ownership, Prisma models/migrations, auth/RBAC, WebSocket/SSE, storage/queues/workers/streaming, Compose/env/testing/docs. Verify dependencies/versions from lockfiles and runtime.

Assess duplicates, conflicting domains, circular dependencies, unclear state ownership, inconsistent contracts/errors, frontend-only security, missing constraints and operational dependencies using concrete references. Map Workspace, StreamEvent, staff/attendee principals, admission, LiveSession, BroadcastSession, ChatMessage, Topic/Reply, Poll, MediaAsset and actual MediaUpload model. Operations session, broadcast lifecycle, publisher availability and viewer playback must remain distinct.

## B. Original OpsPilot workflows

- AUTH: staff login/logout/refresh, current session validity, membership/role changes, invalid sessions, workspace isolation and direct protected API access.
- EVENT: create/edit/owner/workspace/schedule, preparation/Launch Control/readiness/configuration, supported lifecycle transitions, invalid transitions and archival immutability.
- ADMISSION: public/restricted/domain registration, invitations where supported, verification/single-use links, attendee session creation/expiry/re-entry/revocation, cross-event denial. Attendees never become workspace members merely by admission.
- OPERATIONS: live session state/updates, SSE/reconnection, notes, readiness, Polls, audit trails, recommendations/optional AI fallback, analytics/reporting/CSV and supported operational workflows. Unsupported capabilities are identified rather than invented.

## C. Chat

Verify staff/attendee real WS communication, PG persistence/reload, pagination, canonical identity, duplicate/retried sends and lost acknowledgements, withdrawal/deletion, current authorization and scope switching. Exercise duplicate/reordered events, stale history, network interruption, permission revocation and bounded incoming bursts.

Real browser proof: older-history anchor, incoming messages while reading, following latest, unread/jump, deletion viewport behavior and bounded DOM. Stale responses/events must not restore deletion or cross-event data. Use real PostgreSQL and socket clients for protected boundaries/recovery, not reducer tests alone.

## D. Topics / Q&A

Verify submit/pending/public approval/replies/edit/pin/unpin/delete/settings and real-time delivery. Derive all/pending/approved/pinned views from consistent canonical state; test duplicate/old revisions/delayed pagination/parent deletion/replies/revocation.

Real PG concurrency: concurrent approval, approval vs deletion, reply vs parent deletion, last available pin slot, conflicting moderation and duplicate requests after ambiguous responses. Only approved topics pin; maximum seven per event; unpin-before-delete where implemented; eligible existing parents; direct API enforces audience publishing/replies/moderation settings. Topics and Polls remain separate.

## E. Unified authorization and security (mandatory cross-cutting gate)

Build principal × operation × scope × transport × timing matrix. Cover current session/membership/role/event capabilities for staff and validated attendees. Verify impersonation/IDOR/escalation, foreign workspace/event and expired/revoked identity through direct REST, WS and SSE, not just controls.

Test long-lived SSE/WS after membership/session revocation as well as initial access. Distinguish new protected requests, already-open subscriptions, signed-grant expiry and already-delivered data. JWT role claims are not indefinite authority. Define the actual allowed revocation latency per boundary before testing.

Independently verify Nest media APIs, private object storage, presigned part/preview URLs, RTMP ingest, HLS master/variant/init/segments and MediaMTX administration. Short-lived bearer grants may retain their documented TTL; that is not permission to issue new grants after revocation or overwrite confirmed canonical originals. Buffered/downloaded bytes cannot be retroactively revoked.

Review CSRF/origin/cookies/CORS, XSS/UGC, unsafe filenames/paths, unsafe storage access, unbounded memory/disk/task consumption, WS tickets, token/stream-key/log leakage, unsafe demo conveniences and effective production validation. Recheck historical session selection and secret logging concerns in OpsPilot itself. Do not print secrets or use unauthorized external targets.

## F. Media Library and background processing

Use actual pipeline: file → one MediaAsset/MediaUpload allocated at initialization → native multipart parts → stored-source validation/finalization → unique initial processing job → BullMQ/FFmpeg → READY → private preview/reuse. Do not require a second asset registration after completion.

Verify accepted/rejected formats/size, boundaries/checksums, per-file/per-part concurrency, confirmed progress, queue-slot release, cancellation/pause if supported, failure/retry, browser reload/reselect/content identity and genuine missing-part resume. Compare SHA-256 and persistent metadata after restart.

Verify idempotent completion/lost responses, ownership, cancel/finalize outcomes, logical deletion vs access revocation vs physical cleanup, abandoned transfer recovery, derivatives/thumbnail/source integrity, persisted failures/retries, duplicate workers and restarts.

Mandatory cross-system faults: object succeeds/DB fails; DB exists/object missing; response lost; asset/job intent commits/enqueue fails; processing outputs exist/final DB commit fails; physical deletion succeeds/DB cleanup commit fails; tombstone commits/storage cleanup fails; worker restart; API restart during finalization. Require explicit recovery and reconciliation, not claimed PG/S3 atomicity.

Independently re-run recent fixes: legacy URL replay before/after READY cannot mutate canonical source; snapshot source version survives uncertain copy/DB rollback; recovery advances past 100 healthy queue entries and an individual failure; real request begun before grant expiry can settle after first cleanup; old still-alive worker cannot regress Redis progress/PG/variants/final events after a new generation wins. Historical already-corrupted data is not declared repaired by new code.

## G. Live Streaming

Mandatory actual FFmpeg/OBS → authorized MediaMTX RTMP → HLS output → browser decoding. Capture publisher availability, event mapping, actual playlists/segments and advancing decoded frames/currentTime; validate audio stream where supported. HTTP 200 or a mounted/static MP4 element is not live proof.

Test prepare/start/end, concurrent commands/idempotency, interruption/reconnect, intentional end, replacement selection with old cleanup revisions, stale updates, PG persistence/API restart and MediaMTX recovery. Viewer pause must not alter global session state.

Real player: init/play/pause/mute/fullscreen/buffering, autoplay refusal, errors/retry, source/event changes, unmount/stale callbacks and repeated mount/unmount. Measure hls.js/listeners/timers/subscriptions where practical; record browser/platform limitations. Direct unauthenticated/wrong-event/expired RTMP/HLS/admin bypass must be denied. Keep deferred recording/transcoding/CDN/ABR outside scope.

## H. One coherent end-to-end product journey

Use the SAME workspace/event/media asset/broadcast across the journey; record synthetic fixture IDs and step evidence. Distinguish fixture setup via SQL from product actions through supported UI/API. Required participants: staff operator/moderator and independently admitted attendees, with read-only/foreign-scope controls.

1. Select supported workspace; create event; complete Launch Control hard requirements.
2. Configure admission; upload/process/attach a real media asset.
3. Create/start broadcast; connect authorized synthetic publisher; admit attendees and prove Watch Room playback.
4. Send/moderate Chat; submit/approve/reply/pin Topic; publish/respond to Poll.
5. Change relevant effective permission using supported mechanism or explicitly labeled authority fixture; verify new REST/WS/SSE operations respect it.
6. Interrupt publisher; prove Chat/Topics/Polls remain functional while video is unavailable; restore publisher and decode again.
7. End broadcast; complete supported operational event lifecycle; inspect persisted records/audit/reporting for the same event.

Also test scope switching cleanup, staff/attendee independence, player error not resetting Chat, broadcast failure not corrupting Topics and media processing failure not taking down live interactions. Do not stitch separate tests into a journey claim. If any mandatory step is blocked, state the exact failure and still finish other audit phases.

## I. Bounded failures and recovery

Exercise API restart, page reload, scoped PG timeout/unavailability, WS/SSE reconnect, owned Redis/worker/MinIO/MediaMTX interruption, publisher disconnect, ambiguous upload/command receipts, duplicates/stale async work and revocation. For each: expected/observed outcome, integrity, automatic vs manual recovery, cleanup, stuck-state risk and unverified assumptions. Whole-service faults require wholly owned instances.

## J. Performance and resources

Observe bounded Chat history/bursts/anchors/DOM, Topic projections, Watch Room, player cycles, large media lists, upload progress and memory/listeners/subscriptions/refetches. Observe DB query plans/indexes/N+1, WS/SSE overhead, API/worker/FFmpeg memory and queue/control responsiveness. Use actual browser/runtime/DB instrumentation; document workload, concurrency, duration, percentile/memory method and stops. Separate JS heap, native/media memory and different processes. Local results are not production scale; no invented before/after gains.

## K. Database/migrations

Review all migrations and complete schema: ownership/FKs/constraints/indexes/cascades, separate principals, interaction parents, idempotency and upload/broadcast states. Create a fresh owned DB from migrations. Verify existing-data compatibility with representative predecessor fixtures, including original columns and relationships, without touching shared dev data. Identify manual prerequisites/extensions/backfill/data risks. Only drop probe-created databases.

## L. Builds/infrastructure/dependencies/hygiene

Run relevant type/lint/unit/state/API/PG/WS/storage/queue/FFmpeg/MediaMTX/browser/performance suites, frontend/backend production builds, Compose config, image/startup/health probes and dependency audits. Never claim skipped tests pass or silently auto-fix dependencies.

Review env validation, cookies/origin/secret handling, service networking/ports/health/start order/volumes/restart, migration and worker deployment, private media and production vs demo settings. Check tracked secrets/binaries/temp files/proprietary captured Mudu material/setup docs. HTTPS/cloud/HA/horizontal scale/backup restore require actual evidence or NOT VERIFIED, not a local readiness claim.

## M. Test quality

Inspect meaningful assertions, real vs mocked dependencies, negative/security/concurrency/stale/recovery/persistence/resource/decoding proof, flakes/skips/disabled checks and critical gaps. Map test IDs to requirement IDs and gate criticality. Existing passing totals do not replace missing critical evidence.

## N. Architecture and code quality

Assess domain cohesion/module responsibilities/state ownership/error handling/authorization/React/Nest/Prisma/WS+SSE/media/queues/streaming/observability/operability with concrete examples. Separate actual correctness risks from bounded technical debt; no speculative framework replacement or style-as-critical findings.

## 4. Verdict and strict gate

Exactly one overall PASS / CONDITIONAL PASS / FAIL. Separately: Portfolio Demo Ready YES/NO; Local Engineering Acceptance YES/NO; Production Deployment Ready YES/NO/NOT VERIFIED.

PASS requires no P0/P1, secure current staff/attendee and workspace/event boundaries, real Chat history/recovery, Topic moderation/concurrency/settings, Polls, multipart/resume/private persistence/processing, real authorized RTMP and decoded HLS, broadcast recovery, one cohesive Watch Room journey, critical consistency/failure recovery, original regression, required type/build/integration/browser success, and no critical NOT VERIFIED.

CONDITIONAL PASS is only for clearly bounded non-critical issues. Critical failures/security/data risk/missing mandatory runtime proof require FAIL even if most tests pass. A portfolio/local PASS never implies production readiness.

## 5. Deliverables

Create:
- `docs/acceptance/opspilot-final-system-acceptance.md`
- `docs/acceptance/opspilot-final-defect-register.md`
- `docs/acceptance/opspilot-remediation-plan.md`
- Sanitized evidence index under `docs/acceptance/opspilot-final-system-evidence/`.

The main report includes executive verdict; actual architecture and concise diagram; requirement matrix with PASS/FAIL/NOT VERIFIED/NOT IMPLEMENTED/DEFERRED; separate original/Chat/Topics/Permissions/Media/Streaming/Watch/Polls/shared results; single-journey timeline; security and PG/storage/queue/streaming recovery; measured performance; exact baseline/environment/commands/counts/failures/skips/blockers; technical assessment; final gate classification.

Every defect has stable ID, P0/P1/P2/P3, affected module, reproducible steps, expected/actual, evidence, established root cause (or uncertainty), files, recommended fix and regression needed. P0 means severe compromise/data loss/fundamental failure; P1 important broken/security/reliability/domain boundary; P2 moderate/recoverable/important missing coverage; P3 minor/docs/usability. Prioritize remediation by security/integrity → critical workflow → reliability/concurrency → regression → measured performance → noncritical debt. Do not implement it.

Docs/evidence-only Git checkpoints are allowed; retain exact application baseline hash separately. No application changes may be committed. Final response provides verdict/demo/production status, all modules and original regressions, all P0/P1 and P2/P3 counts, real streaming/upload/processing/unified security/journey results, actual commands, performance/recovery, blockers, priority plan, three paths and reviewed commit/branch.

STOP after delivering this audit. Do not fix findings, migrate another module or perform unrelated development.
