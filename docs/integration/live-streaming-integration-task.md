# Task: OpsPilot StreamOps — Live Streaming Integration

## 1. Your Role

Act as a Principal Full-stack Engineer, Streaming Systems Engineer, and Senior Frontend Architect.

We are integrating independently developed Mudu Engineering Showcase capabilities into OpsPilot.

OpsPilot is the primary product and destination repository.

The integration roadmap is:

1. Foundation + Chat — completed
2. Topics / Q&A — previous integration phase
3. **Live Streaming — current task**
4. Media Library enhancements — future phase
5. Final system-wide acceptance

Your task is to integrate the existing Mudu Live Streaming implementation into OpsPilot's StreamOps domain.

The result must be a working, integrated livestream experience, not a separate application or mock video player.

Do not begin the Media Library migration.

## 2. Architecture and Existing Systems

Preserve OpsPilot's existing architecture:

- Next.js App Router
- React and TypeScript
- NestJS
- Prisma and PostgreSQL
- Existing Workspace and StreamEvent domain
- Existing staff authentication
- Existing attendee registration and admission
- Existing unified event-scoped authorisation
- Existing Chat integration
- Completed Topics integration, including acceptance fixes 349ea30 and bf35f83
- Existing Polls
- Existing SSE operational updates
- Existing media and infrastructure services

Inspect the actual repositories before making changes.

The original Mudu Showcase implementation used:

- MediaMTX
- RTMP publishing
- HLS playback
- React player lifecycle management
- NestJS livestream state management
- WebSocket state synchronisation
- Room-level streaming permissions

Reuse the independently developed implementation where appropriate, adapting it to OpsPilot.

Do not copy historical captured Mudu proprietary code, branding, production bundles, or private research assets into OpsPilot.

## 3. Establish the Integration Baseline

Before implementation:

1. Inspect both repositories.
2. Record the current Git commit and working-tree state.
3. Review the completed Chat and Topics migrations.
4. Review existing acceptance reports.
5. Inspect OpsPilot's Live Operations architecture.
6. Inspect Mudu's Live Streaming implementation and tests.
7. Review any unresolved streaming P0/P1 security or correctness issues.
8. Check the previously reported session-selection and stream-key logging defects.
9. Identify reusable backend, player, media-server, and test components.

Do not assume a previous development or acceptance claim is correct without supporting evidence.

Produce:

`docs/integration/live-streaming-integration-plan.md`

Include the target architecture, model mapping, permission contract, streaming pipeline, integration risks, and implementation stages.

Then proceed with development.

---

# Phase A — Unify Event and Broadcast Domain Models

## A1. Preserve OpsPilot LiveSession

OpsPilot already contains a LiveSession concept representing operational activity within an event.

Do not replace or rename that model without strong justification.

Introduce or adapt a separate:

`BroadcastSession`

This represents an actual video broadcast session.

The relationship should be based on the existing StreamEvent model.

Conceptually:

StreamEvent
- Existing LiveSession (operational session)
- BroadcastSession(s) (video broadcasts)
- Chat
- Topics
- Polls

Use the actual database relationships rather than blindly copying this conceptual structure.

A StreamEvent entering its LIVE business state must not automatically imply that a video publisher is connected.

## A2. Database Design

Design additive Prisma models and migrations.

Support:

- Event-scoped broadcast identity
- Broadcast session status
- Publisher/stream configuration references
- Start and end timestamps
- Active session identity
- Stream availability
- Relevant stream revision or generation tracking
- Operational metadata

Preserve existing OpsPilot data.

Do not duplicate User, Workspace, StreamEvent, or attendee identity tables.

Enforce appropriate uniqueness and lifecycle constraints.

Avoid multiple conflicting active broadcast sessions for the same event unless deliberately supported.

Keep media bytes outside PostgreSQL.

## A3. Separate Three Types of State

Explicitly distinguish:

1. Event operational state
2. Broadcast session and actual publisher availability
3. Individual viewer playback state

Examples:

- An event may be live while its video stream is unavailable.
- OBS may disconnect while the event remains active.
- A viewer pausing playback must not change the broadcast session.
- A viewer experiencing buffering must not mark the entire event offline.

Document the state model and valid transitions.

---

# Phase B — Real Streaming Infrastructure

## B1. Integrate MediaMTX

Reuse or adapt Mudu's actual MediaMTX configuration.

Use OpsPilot's existing Docker Compose environment.

The required pipeline is:

OBS / FFmpeg
    → RTMP
    → MediaMTX
    → HLS
    → Browser playback

Requirements:

- Real RTMP ingest
- Actual media publishing
- Real HLS playlists and segments
- Browser-compatible video delivery
- Publisher connection and disconnection detection
- Event-specific stream mapping
- Documented local configuration
- Correct container networking
- Appropriate service restart behaviour

Verify the exact MediaMTX version and configuration capabilities before reusing the previous configuration.

Do not rebuild RTMP or HLS protocols.

Do not replace real publishing with playback of an uploaded MP4.

An FFmpeg-generated live test source is acceptable for automated integration testing.

## B2. Streaming Security

Secure the MediaMTX boundary independently of NestJS.

Requirements:

1. Only authorised publishers can publish.
2. Publisher credentials are not exposed to viewers.
3. Direct RTMP connections cannot bypass authorisation.
4. Guessing a StreamEvent ID cannot grant publishing permission.
5. MediaMTX management endpoints are appropriately isolated.
6. Credentials and stream keys are not logged.
7. Revoked publishing permissions follow a documented invalidation policy.
8. Secret rotation is supported where the chosen architecture requires it.

Inspect the historical Mudu stream-key logging issue before migrating related code.

If real credentials have been exposed, document the remediation and rotate affected credentials where authorised.

Do not commit secrets.

---

# Phase C — NestJS Broadcast Module

Integrate a Broadcast module into OpsPilot's existing backend.

Responsibilities:

- Broadcast session management
- Event-to-stream mapping
- Publisher authorisation
- Stream availability detection
- Broadcast lifecycle transitions
- PostgreSQL persistence
- MediaMTX integration
- WebSocket status events
- Permission enforcement

Reuse existing NestJS module conventions and infrastructure.

## C1. Broadcast Lifecycle

Implement an explicit lifecycle appropriate to the product.

Candidate states:

- WAITING
- STARTING
- LIVE
- INTERRUPTED
- ENDED
- ERROR

Use the final documented model rather than assuming these exact enum names.

An administrator starting a broadcast session does not mean OBS has successfully connected.

A broadcast should be reported as receiving live video only when the media infrastructure confirms the stream is available.

Handle intentional termination separately from unexpected publisher interruption.

## C2. Stream Status Reconciliation

Use supported MediaMTX notifications, APIs, or equivalent server-side stream observations.

Handle:

- Publisher connected
- Stream available
- Publisher disconnected
- Publisher reconnected
- Broadcast intentionally ended
- NestJS restart
- MediaMTX restart
- Duplicate or delayed status events

Protect the current session from stale notifications associated with earlier broadcasts.

Implement a bounded reconciliation mechanism so missed notifications do not cause permanently incorrect status.

Do not trust the browser as the authoritative source of broadcast availability.

## C3. Concurrency and Idempotency

Review:

- Concurrent broadcast starts
- Concurrent stop requests
- Duplicate create requests
- Stop/start races
- Previous publisher reconnecting after a new session begins
- Lost backend responses
- Database transaction boundaries

Ensure the database and streaming infrastructure converge toward a consistent documented state.

Do not build unnecessary distributed orchestration infrastructure.

---

# Phase D — Integrate Authentication and Permissions

Reuse the unified principal model already established by Chat integration.

OpsPilot has two distinct identity types:

- Workspace staff
- Validated event attendees

Do not create a new Mudu user or login system.

Authorisation must support event-scoped capabilities such as:

- broadcast.view
- broadcast.manage
- broadcast.publish

Adapt names and capability mapping to existing conventions.

Requirements:

1. Staff can manage broadcasts only when currently authorised.
2. Attendees can watch broadcasts according to existing event admission rules.
3. Staff permissions are checked against current effective membership and policy.
4. Attendees do not need WorkspaceMembership.
5. REST APIs enforce authorisation.
6. WebSocket commands and protected events enforce authorisation.
7. Direct MediaMTX ingest requests enforce publishing restrictions.
8. Cross-event and cross-workspace access is prevented.
9. Permission changes are respected during active sessions.

## Viewer Access Policy

Inspect OpsPilot's actual event visibility and attendee-admission rules.

Determine whether each supported broadcast is public or requires event admission.

Enforce the chosen policy at the media delivery boundary, not just through the React page.

For restricted viewing, protect HLS playlist and segment access using a suitable mechanism supported by the actual MediaMTX deployment.

Ensure temporary authorisation mechanisms work for ongoing HLS segment requests and have appropriate revocation and expiry semantics.

Do not leave direct HLS URLs unintentionally public when the corresponding event requires admission.

---

# Phase E — React Player Integration

Adapt the completed Mudu player implementation to OpsPilot's App Router.

Do not embed the original Mudu Pages Router application.

Build or reuse a dedicated player abstraction.

## E1. HLS Playback

Support:

- Actual live HLS playback
- Native HLS where appropriate
- hls.js where required
- Play/pause
- Mute/unmute
- Volume
- Fullscreen
- Buffering feedback
- Stream unavailable feedback
- Playback errors
- Retry/recovery
- Source switching
- Cleanup on unmount

Respect browser autoplay restrictions.

Do not claim playback success merely because an HLS URL returns HTTP 200.

## E2. Player Lifecycle

Focus on:

- Player instance ownership
- Asynchronous play promises
- hls.js instance cleanup
- Event listeners
- Retry timers
- Media attachments
- React effect remounts
- Rapid navigation
- Event switching
- Old stream callbacks updating new state

Ensure that only the active event and broadcast can update the current player state.

Separate player-local state from backend broadcast status.

## E3. Recovery

Test:

- Publisher interruption
- Viewer network interruption
- Browser page reload
- Playback source changes
- Stream becoming available after page load
- Browser autoplay rejection
- Navigation away while reconnecting

Use bounded retries and clear recovery states.

Avoid uncontrolled player recreation.

---

# Phase F — Build OpsPilot Watch Room

This is a key product deliverable.

Create a cohesive attendee-facing Watch Room for an admitted participant.

The page should bring together existing modules within the same StreamEvent context:

1. Live video player
2. Real-time Chat
3. Topics / Q&A
4. Existing Polls
5. Broadcast availability and relevant event information

Reuse completed components and their services.

Do not reimplement Chat, Topics, or Polls inside the streaming module.

Do not duplicate data fetching, identity resolution, or WebSocket infrastructure.

A participant should be able to watch the broadcast and interact with the event without navigating between unrelated applications.

## Watch Room Behaviour

Verify that:

- Video playback works independently of Chat.
- Chat history is preserved when the video player reconnects.
- Topics remain visible when the broadcast is interrupted.
- Polls continue functioning.
- Switching events clears event-specific state correctly.
- Attendee admission is respected.
- Layout remains usable on common desktop and mobile viewport sizes.
- The page displays appropriate waiting, live, interrupted, and ended states.

Prioritise functional integration and clear UI over elaborate visual redesign.

---

# Phase G — Enhance Existing Live Operations

Integrate broadcast management into OpsPilot's existing staff interface.

Do not replace the existing operations dashboard.

Support:

- Broadcast session status
- Publisher connection state
- Stream publishing instructions for authorised staff
- Broadcast start/end controls, where supported
- Video preview
- Stream interruption notifications
- Basic operational diagnostics
- Existing Chat moderation
- Existing Topics moderation
- Existing Poll management
- Existing operational updates

Preserve the existing SSE infrastructure unless a demonstrated integration requirement justifies changing it.

Live-stream state updates may use the authenticated WebSocket infrastructure already established by Chat and Topics.

Do not rewrite unrelated operational state management.

---

# Phase H — Cross-module Reliability

The integrated product must support simultaneous activity.

Test scenarios including:

## Scenario H1 — Complete Event Workflow

1. Staff logs into OpsPilot.
2. Staff opens an existing StreamEvent.
3. Staff prepares or starts a broadcast session.
4. An authorised publisher connects.
5. An attendee completes the existing admission flow.
6. The attendee opens the Watch Room.
7. Real HLS video plays.
8. The attendee sends a Chat message.
9. Staff receives and moderates Chat.
10. The attendee submits a Topic.
11. Staff approves it.
12. The approved Topic becomes visible.
13. Participants interact with existing Polls.
14. Publishing is interrupted and restored.
15. Chat, Topics and Polls remain consistent.
16. The session is intentionally ended.

## Scenario H2 — Publisher Interruption

Disconnect and reconnect FFmpeg/OBS.

Verify the authoritative broadcast state, WebSocket status updates, and player recovery.

## Scenario H3 — Room/Event Switching

Switch events while video and subscriptions are active.

Verify player cleanup and complete event isolation.

## Scenario H4 — NestJS Restart

Restart NestJS while MediaMTX remains active.

Verify that broadcast availability is reconciled correctly and the client can recover state.

## Scenario H5 — Permission Revocation

Test management, publishing and viewing revocation separately against the documented capability matrix. Losing manage denies management commands; losing publish denies new ingest and terminates existing ingest within the healthy control-plane bound; losing view denies new protected media requests. Do not assume manage and publish are interchangeable.

## Scenario H6 — Direct Media Access

Attempt unauthorised publishing and, for restricted events, direct HLS access.

Verify that access cannot be obtained by bypassing OpsPilot's UI.

---

# Phase I — Automated Testing

Use OpsPilot's existing test infrastructure.

## Unit Tests

Cover:

- Broadcast lifecycle transitions
- Session identity
- Event isolation
- Stale notification rejection
- Player state handling
- Player resource cleanup
- Permission rules

## Backend Integration Tests

Use real PostgreSQL where required.

Cover:

- Broadcast session persistence
- Idempotency
- Authorisation
- Concurrent lifecycle operations
- Reconciliation
- Cross-event isolation
- Stream status updates

## Streaming Integration Tests

Run actual MediaMTX and a deterministic FFmpeg publisher.

Verify:

- RTMP ingestion
- HLS resource availability
- Actual video bytes
- Publisher disconnect/reconnect
- Security enforcement
- Backend status reconciliation

## Browser E2E

Use real browser contexts and an actual live stream.

Verify:

- Staff broadcast management
- Attendee admission
- Watch Room playback
- Video time/frame progression
- Chat and Topics alongside playback
- Poll interaction
- Interruption and recovery
- Event switching
- Player cleanup

Mock-only tests do not satisfy real-streaming acceptance.

## Regression Testing

Run relevant existing OpsPilot tests for:

- Chat
- Topics
- Polls
- Workspace authentication
- Attendee admission
- Event management
- Live Operations and SSE
- Media workflows
- Permissions

Run type checks, linting, production builds, and relevant container-startup checks.

Do not weaken existing tests or claim unexecuted tests passed.

---

# Phase J — Performance and Reliability Verification

Perform controlled, reproducible observations.

Focus on:

- Playback startup time
- HLS stream availability
- Publisher interruption detection
- Playback recovery time
- Player CPU/memory usage
- React rendering during state changes
- Subscription and listener cleanup
- Watch Room responsiveness while Chat and Topics are active

Document actual measurements and limitations.

Do not introduce WebRTC merely to achieve lower latency in this phase.

HLS is the mandatory playback target.

WebRTC is excluded from implementation in this phase, including optional reuse. It may only be documented as a future enhancement.

Do not claim production-scale reliability from local testing.

---

# Phase K — Documentation

Create:

`docs/integration/live-streaming-migration-report.md`

Include:

1. Integration architecture
2. Source-to-destination module mapping
3. BroadcastSession versus LiveSession
4. StreamEvent associations
5. Prisma schema changes
6. MediaMTX integration
7. RTMP/HLS data flow
8. Publishing and viewing security
9. React player architecture
10. Watch Room integration
11. WebSocket and SSE coexistence
12. Failure recovery
13. Test execution evidence
14. Performance observations
15. Security findings
16. Known limitations
17. Architectural decisions and trade-offs

Also provide exact local verification instructions, including an FFmpeg example that does not expose credentials in committed files or reports.

Update existing OpsPilot documentation as necessary.

---

# Phase L — Scope Control and Execution

## Mandatory

- Preserve OpsPilot as the primary product
- Reuse existing event and identity systems
- Implement BroadcastSession integration
- Integrate real MediaMTX/RTMP publishing
- Integrate real HLS playback
- Implement reliable broadcast status synchronisation
- Integrate existing permissions
- Build the attendee Watch Room
- Enhance existing Live Operations
- Preserve Chat, Topics and Polls
- Verify interruption/recovery
- Run real integration and E2E tests
- Document and commit the changes

## Excluded

- Rebuilding Chat
- Rebuilding Topics
- Rebuilding Polls
- Migrating the entire Mudu Media Library
- Introducing a new login system
- Creating a duplicate Room/Workspace hierarchy
- Implementing a custom RTMP server
- Building a transcoding pipeline
- Implementing new recording/replay systems
- Complex CDN infrastructure
- Major redesigns of unrelated OpsPilot screens
- Unnecessary new infrastructure

## Autonomous Workflow

Proceed through:

1. Source and destination audit
2. Architecture plan
3. Prisma integration
4. MediaMTX integration
5. NestJS Broadcast module
6. Authorisation integration
7. WebSocket status integration
8. React player adaptation
9. Watch Room
10. Live Operations integration
11. Failure recovery
12. Automated testing
13. Regression testing
14. Documentation
15. Git checkpoint

Work autonomously through routine implementation decisions.

Escalate only destructive operations, unavailable credentials, source-provenance uncertainty, or significant architectural changes outside the approved scope.

Only modify OpsPilot unless separately authorised.

Preserve both repositories and their Git history.

Do not reset shared databases, delete user media, or expose production credentials.

---

# Completion Criteria

The integration is complete when:

1. OpsPilot remains fully functional.
2. BroadcastSession is integrated into the existing StreamEvent domain.
3. Operational LiveSession remains conceptually and technically distinct.
4. Real FFmpeg/OBS publishing works through MediaMTX.
5. Real HLS video plays in an independent browser.
6. Authorised attendees can enter the Watch Room through OpsPilot admission.
7. Chat, Topics and Polls function alongside the livestream.
8. Staff can manage broadcasts through existing OpsPilot authentication.
9. Direct media-server publishing access is protected.
10. Restricted playback follows the actual event access policy.
11. Publisher interruption and recovery work.
12. Backend restart reconciliation works.
13. Player lifecycle and event switching are correct.
14. Real PostgreSQL, WebSocket, and streaming integration tests pass.
15. Existing OpsPilot regression tests pass.
16. Type checks, linting and production builds pass.
17. Documentation is complete.
18. No unresolved P0/P1 defects remain within this phase.

At completion, provide:

- Features integrated
- Reused and adapted Mudu components
- Database migrations
- Infrastructure changes
- Exact test commands and actual results
- Real streaming verification evidence
- Security findings
- Existing feature regression results
- Remaining limitations
- Git commit and branch
- Documentation paths

**STOP after Live Streaming integration. Do not begin Media Library enhancements or unrelated modules.**

# Approved Review Addendum — 30 October 2026

These concrete integration constraints refine the requirements above and take precedence over ambiguous examples.

1. Baselines: OpsPilot `bf35f83` on `feat/streamops-chat-integration`, clean; Mudu `7bd9a2f`, with existing untracked historical streaming audit/evidence untouched. Preserve completed Chat and Topics including their regression fixes. Review Mudu LS-01 (mutable revision incorrectly selected retired session) and LS-02 (callback internal secret in transport-error URLs), their fixes and regressions; do not treat the historical FAIL report as the current source status.
2. Produce an Event/operational LiveSession/BroadcastSession lifecycle matrix before coding. Polls currently require LIVE event + ACTIVE operational LiveSession. Starting video must not implicitly start operations; stopping video must not stop Chat, Topics or Polls. Event completion closes attendee admission according to current policy and must invalidate active media access.
3. One ACTIVE broadcast per event, enforced in PostgreSQL. Select ACTIVE first, otherwise immutable terminal ordering. Old cleanup and delayed observations cannot replace or mutate the new current session. Distinguish lifecycle from availability, including UNKNOWN for failed observations. Persist cleanup intent before external stop/kick; do not perform network IO inside authorization/event-lock transactions.
4. Default Watch Room access remains verified staff or admitted attendees, including events with PUBLIC registration policy. Do not add anonymous watching. Add an App Router `/events/[id]/watch` entry using existing attendee sessions; preserve registration, email verification and logout. Reuse existing attendee Polls, Chat and Topics. Player restart must not remount interactions. Reuse the authenticated Gateway/ticket patterns without requiring existing module sockets to be combined.
5. Publish, manage and view are distinct capabilities. Define current-role mappings, credential binding, expiry, rotation and revocation behavior. HLS authentication covers all playlists, initialization/media segments, redirects and caches, not just the page. Test stolen/cross-event/expired/revoked links. No browser-visible relay/management credentials. Never promise recall of bytes already buffered.
6. Adapt the global API throttler for frequent HLS requests and media callbacks using bounded, resource-appropriate controls; do not disable global protection. Cover multiple simultaneous viewers through actual throttle windows. Audit the destination error-report pipeline (currently records originalUrl) as well as media logs; never persist ticket/query/password/Authorization secrets in logs, error records, traces or reports. Probe refused connections, timeout and 503 failures with generated disposable secrets.
7. Require long-lived playback across two renewal cycles, revocation during renewal, MediaMTX restart, authentication outage, stop while control API is unavailable, old-publisher reconnect after replacement, and lost create/end responses. Record thresholds and sample methodology before testing, not retroactively. Separate request denial, active-ingest termination and buffered playback semantics.
8. Pin versions and a browser-compatible publishing profile (H.264/AAC). RTMP to HLS only; no transcoder, WebRTC, recording or replay. Chromium real decoded playback is the mandatory local browser gate. Native Safari/iOS remains NOT VERIFIED if unavailable and is not advertised as certified; this platform-specific gap does not block the scoped local Chromium gate.
9. Use isolated PostgreSQL, Redis/media containers, storage namespace and publisher fixtures. Do not reset shared databases, copy secrets, interrupt Mudu services, or kill unrelated processes. Keep defaults streaming-disabled so existing OpsPilot development/regressions work without MediaMTX. Document exact opt-in startup and test commands and restore owned development services after tests.
10. Completion requires the mandatory streaming/security/recovery and existing regression gates, no unresolved in-scope P0/P1, reviewed checkpoints, and the migration report. Stop after this integration; no Media Library enhancements.
