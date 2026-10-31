# Task: Independent Acceptance Audit — OpsPilot Live Streaming & Watch Room Integration

## 1. Your Role

Act as an independent Principal Full-stack Engineer, Streaming Systems Engineer, Application Security Engineer, and QA Lead.

We have recently integrated the Mudu Engineering Showcase's Live Streaming capabilities into the existing OpsPilot StreamOps product.

Your task is to conduct a rigorous, evidence-based acceptance audit of this integration.

**This is an independent acceptance review, not a development task.**

Do not assume the implementation is correct merely because the development Codex reported completion.

Do not modify application source code, silently fix defects, rewrite tests, or introduce new features.

Your job is to determine whether the integrated system genuinely works, whether its security boundaries are correct, and whether the migration has introduced regressions.

---

## 2. Project Context

OpsPilot is the primary application.

Existing capabilities include:

- Workspace and event management
- Staff authentication
- Attendee registration and admission
- Live Operations
- Real-time Chat
- Topics / Q&A
- Live Polls
- Existing media services
- SSE operational updates
- Event-scoped permissions

The latest integration added:

- Real RTMP publishing through MediaMTX
- HLS browser playback
- BroadcastSession management
- Livestream status synchronisation
- React player lifecycle management
- Live Operations streaming controls
- An attendee-facing Watch Room
- Integration with Chat, Topics and Polls

Expected technology stack:

- Next.js App Router
- React and TypeScript
- NestJS
- Prisma
- PostgreSQL
- Existing WebSocket infrastructure
- Existing SSE infrastructure
- MediaMTX
- FFmpeg or OBS
- Docker Compose

The target product workflow is:

**Event preparation → Registration and admission → Broadcast → Watch Room interactions → Event operations**

Evaluate the actual implementation against the approved integration requirements.

Do not assume that all listed features exist until verified.

---

# Phase A — Establish the Acceptance Baseline

Before executing tests:

1. Inspect the current OpsPilot repository.
2. Record the current Git commit and branch.
3. Check for uncommitted changes.
4. Identify the Live Streaming integration commits.
5. Read the integration plan and migration report.
6. Inspect the actual implementation and infrastructure configuration.
7. Review previous Chat and Topics integration reports.
8. Review unresolved defects and security findings.
9. Identify existing automated tests and coverage gaps.

Expected documents may include:

- `docs/integration/live-streaming-integration-task.md` (including the Approved Review Addendum)
- `docs/integration/live-streaming-integration-plan.md`
- `docs/integration/live-streaming-migration-report.md`
- `docs/integration/chat-migration-report.md`
- `docs/integration/topics-migration-report.md`

If documents are missing, record the limitation.

Create a requirements traceability matrix with:

- Requirement
- Expected behaviour
- Actual implementation
- Source file
- Runtime/test evidence
- PASS / FAIL / NOT VERIFIED / NOT IMPLEMENTED / DEFERRED (only previously approved scope exclusions)

Do not treat documentation claims as proof.

Preserve the reviewed Git baseline.

---

# Phase B — Domain Model and Database Acceptance

## B1. StreamEvent, LiveSession and BroadcastSession

Inspect the actual Prisma schema and NestJS domain design.

The integration must preserve the distinction between:

1. StreamEvent — the OpsPilot event.
2. LiveSession — the existing operational session.
3. BroadcastSession — an actual video broadcast session.

Verify:

- BroadcastSession belongs to the correct event.
- Existing LiveSession semantics remain unchanged.
- Starting an event does not falsely imply video availability.
- Viewer playback state does not modify global broadcast state.
- Stream interruption does not accidentally end the operational event.
- Event-specific broadcasting relationships are correct.
- Database migrations are additive and preserve existing data.

Inspect for unnecessary duplicate Room, User, Workspace, or Session models introduced during migration.

## B2. Database Integrity

Use real PostgreSQL integration tests.

Verify:

- Session creation and persistence.
- Correct event relationships.
- Active-session uniqueness rules.
- Idempotent start/stop operations.
- Concurrent broadcast start requests.
- Concurrent stop requests.
- Stop/start race conditions.
- Duplicate event handling.
- Database state after interrupted operations.

Pay special attention to stale BroadcastSession selection.

A client must not continue using an old session when a newer active broadcast exists.

Check previous Mudu audit findings concerning session selection and determine whether the integrated implementation addresses them.

---

# Phase C — Real RTMP and HLS Streaming

**This is a mandatory acceptance gate.**

Verify the complete real streaming pipeline:

FFmpeg/OBS
    → MediaMTX RTMP ingest
    → MediaMTX HLS output
    → OpsPilot Watch Room
    → Real browser playback

## C1. Real Publishing

Start the actual local infrastructure.

Use FFmpeg with a deterministic test source, or OBS if available.

Verify:

1. MediaMTX starts correctly.
2. The RTMP ingest endpoint is accessible.
3. An authorised publisher can publish.
4. An unauthorised publisher is rejected.
5. The correct event/stream mapping is used.
6. MediaMTX recognises the active publisher.
7. The application receives or reconciles publisher status.
8. Publishing can be stopped and restarted.

Record the actual test commands, with all credentials redacted.

## C2. Real HLS Playback

Verify:

1. A live HLS playlist becomes available.
2. Live media segments are generated.
3. An admitted attendee can access the Watch Room.
4. The browser successfully receives and decodes video.
5. Playback actually progresses.
6. Video is sourced from the real stream.
7. Browser controls function correctly.
8. Playback handles a missing publisher appropriately.

An HTTP 200 response from a playlist is insufficient evidence.

A mounted `<video>` element is also insufficient evidence.

Verify actual media playback using browser-visible playback state, progression, and real media data.

Do not substitute a Media Library MP4 preview or mocked video element for real streaming acceptance.

## C3. Cross-event Streaming Isolation

Test two separate events.

Verify:

- Their BroadcastSessions are independent.
- Their streaming paths are correctly scoped.
- A publishing credential issued for Event A cannot publish to Event B. A principal without effective authority over B cannot manage B; staff legitimately authorised for both events may operate both.
- An attendee admitted to Event A cannot access restricted Event B playback.
- Switching events cannot leave the previous stream active accidentally.

---

# Phase D — Watch Room Acceptance

This is the main product-level integration requirement.

Verify that the Watch Room provides a coherent attendee experience using the existing OpsPilot admission system.

## D1. Attendee Journey

Test:

1. Attendee accesses a valid event.
2. Attendee completes the existing registration/admission flow.
3. Attendee enters the Watch Room.
4. The correct event and broadcast are loaded.
5. Video plays when the stream is available.
6. Chat can be used.
7. Topics / Q&A can be used.
8. Polls can be used.
9. Event switching and page reload are handled correctly.
10. Expired or invalid attendee access is rejected.

Do not require attendees to become Workspace users.

## D2. Integrated Interaction

With a real livestream playing, use independent browser contexts to verify:

- Attendee sends a Chat message.
- Staff receives the message.
- Staff moderates Chat.
- Attendee submits a Topic.
- Staff approves the Topic.
- The approved Topic becomes visible.
- An authorised participant replies.
- Staff publishes or manages an existing Poll.
- Attendee participates in the Poll.
- Results update according to the existing Poll contract.

Verify that all features use the correct StreamEvent context.

The Watch Room must reuse existing Chat, Topics and Polls implementations rather than maintaining independent duplicate versions.

## D3. Feature Independence

While the livestream is playing:

- Chat history loading must work.
- Topics moderation must work.
- Poll voting must work.

Then interrupt the video stream.

Verify that Chat, Topics and Polls continue functioning according to their own contracts.

Player recovery must not reset message history, lose Topic state or interrupt Poll operations.

---

# Phase E — Live Operations Acceptance

Inspect the existing staff-facing Live Operations interface.

Verify the integration preserved original OpsPilot functionality.

Test:

- Existing operational session controls.
- Existing SSE updates.
- Operational notes and status where implemented.
- Existing Poll management.
- Chat moderation.
- Topic moderation.
- Broadcast management.
- Stream availability indicators.
- Video preview.
- Publisher configuration/instructions.
- Start/end broadcast controls.

Verify that video streaming controls do not overwrite the original operational LiveSession lifecycle.

Check that real-time WebSocket updates coexist correctly with OpsPilot's existing SSE infrastructure.

Look for duplicate connections, unnecessary subscriptions and conflicting state updates.

---

# Phase F — Streaming Lifecycle and Recovery

## Scenario F1 — Publisher Disconnect

1. Start a real FFmpeg/OBS publisher.
2. Open the Watch Room in a browser.
3. Verify playback is working.
4. Unexpectedly terminate the publisher.
5. Verify MediaMTX detects disconnection.
6. Verify NestJS reflects the correct availability.
7. Verify connected clients receive appropriate updates.
8. Verify the Watch Room displays interruption feedback.
9. Restart publishing.
10. Verify state and playback recovery.

Record actual detection and recovery behaviour.

## Scenario F2 — Intentional End

End the broadcast through an authorised staff operation.

Verify:

- Correct BroadcastSession transition.
- Appropriate client updates.
- No accidental continuation of an ended session.
- A subsequent broadcast starts with the correct identity.

Do not confuse temporary disconnection with an intentional end.

## Scenario F3 — NestJS Restart

Keep MediaMTX and the publisher running.

Restart NestJS.

Verify that the backend reconciles:

- Current publisher availability.
- Active BroadcastSession.
- Persisted session state.
- WebSocket subscriptions after reconnect.

Also test when the database indicates a previously active broadcast but no publisher currently exists.

## Scenario F4 — Browser Network Interruption

Temporarily interrupt viewer-side connectivity.

Verify:

- Appropriate playback errors.
- Bounded retry behaviour.
- Recovery when connectivity returns.
- No global broadcast-state changes caused solely by viewer failure.
- No duplicate player instances or subscriptions.

## Scenario F5 — Rapid Event and Session Switching

Switch between events while video is playing.

Inject delayed API responses and player callbacks where possible.

Verify that stale responses from Event A cannot overwrite Event B.

Check for old video sources, subscriptions and incorrectly retained permissions.

---

# Phase G — Player Lifecycle and Resource Management

Review the React player integration.

Verify:

- Correct HLS player initialisation.
- Native HLS/hls.js handling where applicable.
- Play/pause functionality.
- Mute/unmute and volume controls.
- Fullscreen behaviour.
- Buffering feedback.
- Browser autoplay restrictions.
- Playback error recovery.
- Source changes.
- Component unmount.
- React development remount behaviour.

Inspect:

- Event listeners.
- hls.js instances.
- Retry timers.
- AbortControllers.
- WebSocket subscriptions.
- Media attachments.
- Asynchronous play promises.

Use actual browser instrumentation where practical.

Run repeated mount/unmount and event-switching cycles.

Look for accumulating resources and uncontrolled memory growth.

Do not claim resource cleanup is correct based solely on source inspection.

---

# Phase H — Security Acceptance

**This is a critical release gate.**

The integration must enforce security at both:

1. OpsPilot application APIs and WebSocket layer.
2. MediaMTX publishing and media-delivery layer.

## H1. Staff and Attendee Identity

Verify:

- Staff uses existing OpsPilot authentication.
- Attendees use existing admission/session mechanisms.
- Staff and attendee privileges are not interchangeable.
- Client-provided roles are not trusted.
- Current event access is enforced.
- Revoked privileges are respected.

Review whether stale JWT role claims can bypass newly changed database permissions.

## H2. Broadcast Management

Attempt unauthorised operations through direct API requests.

Verify:

- Attendees cannot manage broadcasts.
- Unauthorised staff cannot obtain publishing credentials.
- Staff from Workspace A cannot manage another workspace's broadcasts.
- Event-level permissions are enforced.
- Revocation prevents subsequent privileged operations.

## H3. Direct RTMP Access

Attempt publishing directly to MediaMTX without going through the OpsPilot UI.

Verify:

- Unauthorised publishing is rejected.
- Stream paths cannot be guessed to gain publishing access.
- Credentials are appropriately scoped.
- Previously revoked credentials cannot be used beyond their documented validity policy.
- MediaMTX administration endpoints are not exposed to unauthorised clients.

## H4. Direct HLS Access

Determine the intended event viewing policy.

For restricted broadcasts, attempt direct playlist and media-segment requests without valid admission.

Verify that bypassing the Watch Room cannot bypass the intended access policy.

Review any signed URLs, cookies or token mechanisms for:

- Scope
- Expiry
- Revocation
- Cross-event isolation
- Exposure through logs and browser-visible resources

The approved policy requires verified staff or admitted attendees even for PUBLIC registration events. PUBLIC registration must not be interpreted as anonymous playback permission.

## H5. Secret Handling

Search for sensitive information in:

- Source code.
- Environment files and examples.
- Git-tracked configuration.
- FFmpeg commands.
- Application logs.
- MediaMTX logs.
- Error messages.
- Frontend bundles.
- Test reports.

Previously identified stream-key logging problems must not reappear in OpsPilot.

Redact actual values in the audit report.

Do not expose, copy or publish credentials.

---

# Phase I — Performance and Reliability

Run practical, reproducible tests.

Focus on:

- Stream startup time.
- HLS availability.
- Browser playback startup.
- Publisher interruption detection.
- Playback recovery time.
- Watch Room responsiveness.
- React render behaviour.
- Player memory/resource usage.
- Chat responsiveness during video playback.
- Topic updates while streaming.
- Poll interaction during streaming.

Record the actual workload, environment and measured results.

If no comparable baseline exists, report current measurements without claiming an improvement percentage.

Do not require production-scale load testing for this local engineering showcase.

However, explicitly document which production concerns remain unverified, including multi-instance operation, public TLS deployment and network scalability.

---

# Phase J — Regression Testing

Run the relevant existing OpsPilot regression suites.

Verify each area independently:

## J1. Chat

- Staff/attendee real-time messaging.
- PostgreSQL persistence.
- History pagination.
- Reconnection and deduplication.
- Moderation.
- Scroll and unread behaviour.
- Cross-event isolation.

## J2. Topics

- Submission.
- Approval.
- Replies.
- Pinning.
- Moderation consistency.
- Permission checks.
- Concurrent business invariants.
- Cross-event isolation.

## J3. Polls

- Existing Poll creation and management.
- Voting.
- Result updates.
- Attendee access rules.
- SSE/WebSocket interactions as applicable.

## J4. Existing OpsPilot

- Staff login/logout.
- Workspace permissions.
- Event management.
- Registration and attendee admission.
- Invitations.
- Existing Live Operations.
- Operational SSE updates.
- Existing media upload and processing.
- Relevant audit/operational functionality.

## J5. Shared Infrastructure

Review:

- Prisma migrations.
- Docker Compose.
- NestJS startup and shutdown.
- Next.js build.
- Authentication.
- Environment configuration.
- Shared WebSocket connections.
- Error handling.
- Database relationships.

Report any regressions introduced by Live Streaming integration.

---

# Phase K — Automated Test Execution

Run the available project checks:

- TypeScript checks.
- Linting.
- Unit tests.
- Backend integration tests.
- Real PostgreSQL tests.
- WebSocket integration tests.
- Real MediaMTX/FFmpeg streaming tests.
- Playwright E2E tests.
- Production builds.
- Relevant dependency/security checks.

Inspect test quality.

Identify critical scenarios relying only on mocks.

Do not count mocked media playback as real browser verification.

Do not weaken or rewrite existing tests during this audit.

You may create disposable diagnostic scripts and isolated test fixtures outside the application source, provided they do not affect the reviewed implementation.

Use isolated test databases and storage.

Do not reset shared databases, delete existing user files or alter production services.

If required infrastructure is unavailable, document the blocker and mark the affected requirements NOT VERIFIED.

---

# Phase L — Acceptance Report

Create:

`docs/acceptance/opspilot-live-streaming-watch-room-acceptance.md`

The report must contain:

## 1. Executive Summary

- Overall acceptance result.
- Whether real RTMP/HLS streaming was verified.
- Whether Watch Room integration works.
- Major security and reliability risks.
- Readiness for the next local integration phase, not production deployment certification.

## 2. Requirements Matrix

For each requirement record:

- Requirement ID.
- Expected behaviour.
- Actual behaviour.
- Source location.
- Runtime/test evidence.
- PASS / FAIL / NOT VERIFIED / NOT IMPLEMENTED / DEFERRED.

## 3. Real Streaming Evidence

Include actual FFmpeg/MediaMTX/browser verification details.

Do not include raw credentials.

## 4. Domain and Database Findings

Evaluate StreamEvent, LiveSession, BroadcastSession, persistence and concurrency.

## 5. Watch Room Findings

Describe real browser testing of video, Chat, Topics and Polls together.

## 6. Streaming Lifecycle Findings

Document disconnect, reconnect, intentional end, backend restart and stale-event scenarios.

## 7. Security Findings

Report application API, WebSocket, RTMP, HLS, permissions and credential security independently.

## 8. Performance Observations

Include methodology, measurements and limitations.

## 9. Regression Results

Report Chat, Topics, Polls, Live Operations, authentication, admission and media workflows separately.

## 10. Defects

Classify findings:

- P0 — Critical security, data-integrity or fundamental functionality failure.
- P1 — Major functionality, security or reliability defect.
- P2 — Moderate defect or important missing coverage.
- P3 — Minor defect or improvement.

For every defect, include:

- Reproduction steps.
- Expected behaviour.
- Actual behaviour.
- Evidence.
- Root cause, if established.
- Affected files.
- Recommended remediation.

## 11. Final Decision

Choose exactly one:

- PASS
- CONDITIONAL PASS
- FAIL

PASS requires all mandatory workflows verified and no unresolved P0/P1. CONDITIONAL PASS also requires all mandatory gates verified, with only explicitly noncritical gaps or P2/P3 debt. FAIL applies when a mandatory gate fails or remains unverified, or an unresolved P0/P1 remains. An environmental blocker is NOT VERIFIED, not automatically a code defect.

Do not issue PASS if real RTMP publishing, actual HLS browser playback, mandatory security checks or critical Watch Room integration have not been verified.

## 12. Remediation Plan

Provide a concise, prioritised remediation plan for confirmed findings.

Avoid speculative refactoring or unrelated enhancements.

---

# Phase M — Strict Acceptance Gate

The integrated Live Streaming module passes only when:

1. Real RTMP publishing works.
2. Real HLS playback works in a browser.
3. BroadcastSession and LiveSession remain correctly separated.
4. Stream state matches actual publisher availability.
5. NestJS restart reconciliation works.
6. Publisher interruption and recovery work.
7. Watch Room supports video, Chat, Topics and Polls together.
8. Existing staff and attendee identity systems are reused correctly.
9. REST, WebSocket, RTMP and HLS authorisation policies are enforced.
10. Player lifecycle and event switching work.
11. Existing OpsPilot features remain functional.
12. Critical browser and integration tests pass.
13. Type checks and production builds pass.
14. No unresolved P0/P1 defects remain.

Critical unverified requirements prevent a full PASS.

---

# Execution Rules

- Perform the audit independently.
- Use a new Codex session and an isolated worktree where practical.
- Preserve the implementation baseline.
- Do not modify application source code.
- Do not silently fix issues.
- Do not weaken tests.
- Do not implement new features.
- Do not start Media Library migration.
- Run genuine streaming tests.
- Use independent browser contexts.
- Use isolated disposable test data.
- Never perform destructive operations on shared resources.
- Keep secrets out of reports and commits.
- Record actual commands and results.
- Report blocked tests honestly.

Work autonomously through routine testing and investigation.

Only escalate if destructive actions, unavailable credentials or unsafe infrastructure changes require explicit user approval.

## Final Deliverable

Provide:

1. Overall PASS / CONDITIONAL PASS / FAIL.
2. Real RTMP-to-HLS verification results.
3. Watch Room integration results.
4. P0/P1 findings.
5. Security findings.
6. Broadcast lifecycle and recovery results.
7. Player resource-management findings.
8. Actual test commands and outcomes.
9. Chat, Topics, Polls and OpsPilot regression status.
10. Performance observations.
11. Prioritised remediation plan.
12. Acceptance report path.
13. Reviewed Git commit and branch.

**STOP after completing the acceptance audit. Do not fix defects, migrate Media Library or implement unrelated features.**

# Approved Audit Addendum — 30 October 2026

This addendum resolves ambiguous examples above. Execute the audit only; do not fix defects.

1. **Baseline and authority.** Expected reviewed implementation: `f68717bd1db24828191f4a276658130a94b63e5b`, branch `feat/streamops-chat-integration`; recheck HEAD and the working tree before testing. Implementation checkpoint `2cd658b`. User-approved integration task/addendum defines scope; the plan supplies contracts; the migration report and historical results are claims to verify afresh. Record baseline drift. A new review session/worktree is optional where practical; do not represent a same-agent verification as an independent third-party certification. A read-only implementation checkout with separately stored audit artifacts is acceptable.
2. **Explicit authority matrix.** Independently test current ADMIN/OPERATIONS_MANAGER manage+publish, CONTENT_OPERATOR publish without manage, ANALYST/VIEWER view without privileged commands, and admitted attendees view only for their event. Recheck actual approved policy. Shared workspace staff may legitimately access more than one event. PUBLIC registration still requires admission for watching. Test current database authority with old sessions/JWTs and existing sockets; distinguish metadata read from playback.
3. **Renewal/media boundaries.** Use two independent viewers through at least two playback renewals and normal throttling windows. Test the production-default grant lifetime in at least one sustained real playback run; accelerated TTL is supplemental and must remain test-only. Test revocation during renewal, copied/expired/cross-identity/cross-session/cross-event tickets, and all master/variant/init/segment resources. Inspect redirects, caching, Origin and cookie boundaries. A principal-bound short-lived playback ticket in that browser is expected; internal relay/control credentials must never appear there, and publishing keys are restricted to current authorised staff.
4. **Additional required faults.** Exercise actual MediaMTX restart; new RTMP ingest while authentication is down; end during media-control refusal plus recovery of durable cleanup; lost create/end responses; end revision conflict followed by retry; previous publisher reconnect after replacement; duplicate/delayed observations and stale snapshots. End retries must preserve the original target, not terminate a new session. Distinguish a committed logical end, denying new access, physical publisher termination and already buffered bytes.
5. **Lifecycle/interaction invariants.** READY may prepare video without starting operations. Polls retain LIVE+ACTIVE operational-session rules. End video without ending StreamEvent/LiveSession or closing Chat/Topics/Polls. Business completion/cancellation denies future media and retires active video. Uncertain infrastructure observations may be UNKNOWN, never a fabricated live/offline assertion. Ordinary video restart/renewal must retain sibling interaction state; persisted content must return after API recovery. Cross-page refresh or failed admission revalidation need not preserve unsubmitted drafts under the approved scope; record actual behaviour.
6. **Runtime safety.** A worktree does not isolate ports, databases, Redis, buckets or Compose projects. Inspect wrappers before running them: current development and broadcast tests share MediaMTX ports1937/8890/9999 and API/Web4100/3000. Prefer dedicated audit database, Redis and storage namespace. If fixed ports/media service must be reused, verify process/container ownership and no active user publisher, pause only the owned development stack, run sequentially and restore its original configuration/data at handoff. Never reset/reseed existing databases, flush shared Redis, remove shared volumes or touch the Mudu stack. Any migration preservation probe uses an owned disposable baseline database.
7. **Predeclared local measurements.** Real Chromium decoded frames/time progression is mandatory. With the publisher producing frames, startup<=20s, interruption detection<=10s, recovery after healthy reconnection<=25s, healthy control-plane publisher revocation<=10s. Record timestamps, workloads and at least three startup/recovery samples. New protected requests deny revoked authority; buffered bytes are not recallable. Observe repeated mount/navigation cycles, stale requests, grants, listeners and memory after comparable settle periods. Do not infer leaks or leak freedom from a single heap delta; renderer counters may reset on navigation. Safari/iOS native HLS, production TLS, HA/multi-instance, load/soak and network scale remain NOT VERIFIED outside the mandatory local gate.
8. **Fresh regression evidence.** Run original regression suites with default streaming-disabled configuration, then critical Chat/Topics/Polls/Live Operations/admission flows with streaming enabled and actual playback. Reuse evidence across requirement IDs instead of rerunning identical scenarios unnecessarily. Record initial failures, retries and exact exit codes; do not count a focused rerun as new unique coverage. Dependency/security checks are read-only, with production applicability assessed; never run audit fix or upgrade dependencies.
9. **Evidence and writes.** Allowed writes are this task, the acceptance report, sanitised evidence under `docs/acceptance/opspilot-live-streaming-evidence/`, and disposable diagnostic fixtures/configuration under an ignored audit directory. Do not modify application source, existing test files, migrations, dependency locks or tracked runtime configuration. Independent probes may orchestrate real faults against isolated data without replacing required real backend/media evidence. Never commit raw traces, credentials, publisher URLs or unredacted transport logs. Finish by verifying implementation files still match the reviewed baseline and restoring owned services.
10. **Decision and stop.** DEFERRED is reserved for pre-approved exclusions, never an unexecuted mandatory check. Scope the decision to local RTMP/HLS Watch Room integration. All mandatory gates must pass even for CONDITIONAL PASS; P0/P1 or a critical NOT VERIFIED prevents approval. Report confirmed defects separately from coverage gaps. Deliver the report and prioritised remediation, then stop without fixing defects or starting Media Library.
