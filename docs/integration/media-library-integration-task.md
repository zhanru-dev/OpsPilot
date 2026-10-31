# Task: OpsPilot StreamOps — Media Library Integration and Engineering Upgrade


## Approved review amendments — 2026-10-31

These amendments take precedence over ambiguous statements below. The user approved updating and executing this task after the prompt review.

1. **Prerequisite gate.** Finish the previously authorized Live Streaming acceptance remediation (P1 media processing correlation/idempotency, P2 prepare retry, P3 throttle documentation), run the relevant real regressions, document evidence and commit a stable checkpoint before Media Library implementation. Preserve the historical FAIL report. Initial destination HEAD is 4259e58 on feat/streamops-chat-integration with existing uncommitted remediation; record its final checkpoint separately. Do not treat pending fixes as verified.
2. **Existing identities and compatibility.** Extend existing MediaUpload by default, retaining MediaAsset creation at initialization and the same asset throughout resume/processing. Preserve historical records and the legacy single-PUT API, or document and test a compatible transition. Preserve existing video AND audio formats and processing. Keep the current default 100 MiB / 300-second limits unless evidence justifies an explicitly documented change.
3. **Scope.** Staff workspace media management, advanced upload and existing event association are the product scope. Watch Room, BroadcastSession, Chat, Topics and Polls are regression/integration boundaries. Do not add attendee uploads, interaction attachments, livestream recording, replay/VOD publication or video insertion. Preserve existing attendee media access only where already defined; otherwise defer it.
4. **Permission matrix.** Specify upload owner versus authorized manager operations, workspace asset access and event association separately. Reusing an asset across authorized events is legitimate; do not deny it as a generic cross-event violation. Do not grant attendees workspace membership. Check current database authority at every protected mutation and URL issuance boundary. Bind session ownership server-side.
5. **Storage authorization.** Presigned URLs are bounded bearer grants: application-role revocation denies fresh grants and completion, but does not itself revoke already issued storage URLs. Define their TTL, inflight transfer behavior and abort/cleanup policy, test actual MinIO behavior, and document the remaining access window. Immediate read revocation requires a deliberately protected delivery boundary; do not claim it from API-only checks. Never persist signed URLs or credentials in browser resume metadata/logs.
6. **Integrity/resume.** Define content-based file identity; name/size/mtime alone are insufficient. Test same-name/same-size different bytes. Persist required part receipts and cross-check authoritative storage state, including listing pagination. Verify indices, sizes, total size, checksums and late part overwrites. Multipart ETag is not a whole-file SHA-256. Compare original source and stored original hashes, not transcoded output hashes. Resume transfers only missing/unconfirmed parts.
7. **Cancellation/deletion/concurrency.** Specify state transitions separately for client, upload, asset and processing. Define completion/cancel linearization and cleanup ownership. Asset deletion is a new in-scope operation (existing detach is not deletion). Define referenced-asset policy, durable cleanup of originals/variants/parts and worker fencing so deleted/cancelled state cannot become READY. Pause/resume, route navigation, logout and identity/workspace switching must have explicit behavior. Bound aggregate part concurrency across files, not merely per-file workers.
8. **Recovery.** Reuse and extend current recovery/cleanup services. Durable processing intent precedes enqueue; stable queue/job and phase idempotency keys survive retries. traceId is correlation, not unique job/event/delivery identity. Test missing/stalled/failed Redis jobs versus database state, successful transcode followed by DB failure, finalization after crash, lost responses and cleanup races. Reconciliation must be repeatable, scoped and observable; never sweep/delete shared fixtures.
9. **Resource/security bounds.** Enforce server-side bytes, part count, concurrent active sessions, expiry and processing limits. Inspect actual media with ffprobe and retain existing codec checks. Measure bounded memory, scheduling and cleanup with declared workloads. Local success is not a production capacity or deployment certification.
10. **Evidence gate.** Use isolated PostgreSQL, Redis and bucket data and real MinIO/BullMQ/FFmpeg for critical paths. Preserve failed evidence; critical NOT VERIFIED cases block completion. Record exact commands, results, environment and revisions; restore any owned development services paused for fixed-port tests. Keep source Mudu unchanged and exclude captured/proprietary material. Finish with small checkpoints and stop before final independent system-wide acceptance.

## 1. Your Role

Act as a Principal Full-stack Engineer, Senior Frontend Architect, and Media Infrastructure Engineer.

We are integrating independently developed Mudu Engineering Showcase capabilities into OpsPilot.

OpsPilot is the primary product and destination repository.

The integration roadmap includes:

1. Foundation and Chat — completed
2. Topics / Q&A — previous integration phase
3. Live Streaming and Watch Room — previous integration phase
4. **Media Library — current and final core-module integration**
5. Final system-wide acceptance — future phase

Your task is to integrate the strongest engineering capabilities of Mudu's completed Media Library into OpsPilot's existing media infrastructure.

This is **not a request to replace OpsPilot's Media Library**.

The objective is to build one cohesive, reliable, media workflow with explicitly verified reliability and security guarantees that combines advanced upload management with OpsPilot's existing asynchronous processing pipeline.

Work in the existing OpsPilot repository.

Do not create another application.

---

# 2. Existing Architecture

Inspect both repositories and verify their actual implementations before coding.

## OpsPilot

The existing OpsPilot project includes:

- Next.js App Router
- React and TypeScript
- NestJS
- Prisma and PostgreSQL
- MinIO / S3-compatible object storage
- BullMQ asynchronous job processing
- FFmpeg video processing
- Thumbnail generation
- MediaAsset records and media-management workflows
- Staff authentication and Workspace permissions
- StreamEvent associations
- Existing event preparation workflows
- Chat, Topics, Polls and Live Streaming integrations

The existing media infrastructure is the authoritative foundation.

## Mudu Engineering Showcase

The completed Mudu Media Library includes or was designed to support:

- Chunked uploads
- Bounded concurrent upload workers
- Upload queue management
- Accurate progress reporting
- Cancellation
- Retry
- Resumable upload sessions
- PostgreSQL upload-state persistence
- Persistent object storage
- Idempotent finalisation
- Database/storage consistency handling
- Media preview
- Permission integration
- Browser resource cleanup

Inspect the actual completed code and its acceptance reports to identify which capabilities are fully implemented and verified.

Do not assume documentation claims are correct without evidence.

---

# Phase A — Source Audit and Integration Plan

Before modifying code:

1. Inspect OpsPilot's media architecture.
2. Inspect Mudu's completed Media Library implementation.
3. Read both projects' media-related technical documentation.
4. Review previous acceptance reports.
5. Identify the current OpsPilot Git branch and commit.
6. Confirm whether the previous streaming integration has unresolved P0/P1 issues.
7. Inspect all related Prisma models and migrations.
8. Inspect the current upload protocol.
9. Inspect MinIO integration.
10. Inspect BullMQ job processing.
11. Inspect FFmpeg transcoding and thumbnail generation.
12. Identify existing media API contracts and frontend components.
13. Identify existing authorisation and event-association rules.
14. Review existing media tests.

Create:

`docs/integration/media-library-integration-plan.md`

Include:

- Current OpsPilot functionality
- Verified Mudu functionality
- Features to retain
- Features to adapt or migrate
- Features to replace or remove
- Data-model conflicts
- Proposed upload protocol
- Upload state machine
- Processing lifecycle
- Security boundaries
- Migration risks
- Testing strategy

Then proceed autonomously.

Do not begin implementation by simply copying Mudu's entire Media Library directory.

---

# Phase B — Unified Media Domain Model

## B1. Preserve Existing MediaAsset

OpsPilot already has a MediaAsset model and processing pipeline.

**Do not create a competing second MediaAsset model.**

The existing OpsPilot media asset must remain the authoritative resource throughout its lifecycle.

The intended architecture is:

File selection
→ Reserve one stable existing MediaAsset and MediaUpload identity
→ Chunk or multipart transfer
→ Verify storage completion and finalize that same MediaAsset
→ BullMQ processing
→ FFmpeg transcoding / thumbnail generation
→ Ready or Failed
→ Media Library preview and reuse

A successful upload must not accidentally create duplicate MediaAsset records.

## B2. Database Design

Inspect the current Prisma schema.

Adapt or introduce supporting models only where necessary.

Potential concepts:

- UploadSession
- UploadPart, if justified
- UploadStatus
- MediaProcessingStatus
- Upload idempotency identifiers

Preserve existing MediaAsset relationships and processing models.

Support:

1. Workspace ownership.
2. Event-level association where appropriate.
3. Authorised uploader identity.
4. Upload session identity.
5. Upload progress and confirmed parts.
6. Storage upload identifiers.
7. File metadata.
8. Upload state.
9. Processing state.
10. Retry and recovery information.
11. Cancellation and expiration.
12. Stable association with the final MediaAsset.

Do not copy Mudu's Room, User, Session or MediaAsset models into OpsPilot.

Use additive Prisma migrations.

Preserve all existing media records.

## B3. Lifecycle Separation

Explicitly distinguish:

- Client upload task state
- Backend upload session state
- Object storage completion state
- Media processing state
- Media asset availability state

For example, reaching 100% transferred bytes does not mean FFmpeg processing is complete.

Define clear transitions such as:

QUEUED
→ INITIALISING
→ UPLOADING
→ FINALISING
→ PROCESSING
→ READY

Include appropriate:

- PAUSED
- FAILED
- CANCELLED
- EXPIRED

Use the actual existing project conventions where appropriate.

Do not create inconsistent duplicate status fields without a clear purpose.

---

# Phase C — Advanced Multipart Upload

## C1. Storage Upload Protocol

Evaluate the current OpsPilot upload mechanism before deciding how to integrate Mudu's chunking approach.

Prefer reusing MinIO's S3-compatible multipart upload capabilities if they meet the required behaviour.

Do not implement a second custom chunk-storage system unnecessarily.

The upload protocol must support:

- Upload initialisation
- File validation
- Multipart upload
- Confirmed-part tracking
- Upload status queries
- Completion
- Cancellation
- Retry
- Resume
- Safe cleanup

The historical Mudu design used approximately 5 MiB chunks and three concurrent workers.

Use these as reference points, not mandatory configuration values.

Choose sensible part sizes and concurrency limits based on the actual S3-compatible storage constraints and measured behaviour.

For S3 multipart uploads, respect the minimum non-final part size and other relevant limits.

## C2. Real Backend Operations

Implement or adapt NestJS APIs that securely coordinate:

1. Upload session creation.
2. Multipart session initialisation.
3. Part upload authorisation.
4. Part completion/status reporting.
5. Missing-part discovery.
6. Final multipart completion.
7. Finalisation of the already reserved MediaAsset; do not create a second asset.
8. Upload cancellation.
9. Expired-session cleanup.
10. Upload reconciliation.

If using presigned upload URLs, preserve their intended benefits and restrict their scope and lifetime.

The backend must verify authoritative multipart state before finalisation rather than trusting the client's list of completed chunks.

Validate actual object properties and file metadata.

Do not expose MinIO administrative credentials to the browser.

## C3. Idempotency

Ensure:

- Duplicate initialisation requests are handled appropriately.
- Retried part uploads cannot corrupt data.
- Duplicate completion requests are safe.
- Lost completion responses do not create duplicate assets.
- Repeated registration does not create multiple processing jobs unintentionally.
- Reconciliation can recover the authoritative result after ambiguous network failures.

Use appropriate database uniqueness constraints, idempotency keys and transaction boundaries.

Do not claim exactly-once execution merely because an API returns a successful response.

---

# Phase D — Frontend Upload Manager

Adapt the strongest parts of Mudu's upload manager to OpsPilot's React and App Router architecture.

Do not copy Pages Router-specific screens.

Implement a maintainable upload manager supporting:

- Multiple file selection
- File validation
- Upload queue
- Concurrent transfers
- Per-file progress
- Upload status
- Pause where supported
- Cancellation
- Retry
- Resume after interruption
- Clear error messages
- Finalisation and processing status
- Safe cleanup

## D1. Concurrency Scheduling

The scheduler must:

1. Enforce configured concurrency limits.
2. Reserve worker slots before launching asynchronous tasks.
3. Release slots after success, failure or cancellation.
4. Avoid duplicate part scheduling.
5. Avoid starvation of queued uploads.
6. Prevent completed or cancelled tasks from being restarted accidentally.
7. Distinguish per-file and per-part concurrency.
8. Bound memory and network usage.

Use a central, well-defined state machine rather than scattered asynchronous flags.

Do not introduce a large general-purpose task framework.

## D2. Accurate Progress

Progress must distinguish:

- Bytes transferred
- Parts confirmed
- Upload finalisation
- Server-side media processing

Do not show an asset as READY merely because its bytes have reached object storage.

Avoid progress values exceeding 100%, becoming negative or moving backwards without a documented reason.

Use appropriately throttled UI updates to prevent unnecessary React renders.

## D3. Retry and Cancellation

Handle:

- Individual part failure
- Network interruption
- Expired presigned URLs
- Server errors
- Upload session expiration
- User cancellation
- Cancellation during finalisation
- Duplicate callbacks
- Stale asynchronous requests

Use AbortController where appropriate.

Ensure cancellation and finalisation have deterministic documented semantics.

A cancelled upload must not accidentally produce a usable published asset.

If finalisation already committed, report the authoritative result and use the correct asset-deletion workflow rather than pretending cancellation reversed it.

## D4. Browser Reload and Resume

Implement genuine resumability.

Required flow:

1. Start uploading a large file.
2. Complete some parts.
3. Interrupt the upload.
4. Reload the browser.
5. Recover the persisted upload session.
6. Ask the user to reselect the file if necessary.
7. Verify file identity.
8. Query authoritative server-side part status.
9. Upload only missing or unconfirmed parts.
10. Complete the upload.
11. Verify final file integrity.

Do not persist arbitrary File objects in localStorage.

Do not store large Blob data in Redux.

Do not call restarting an entire upload "resume" unless that limitation is explicitly disclosed.

Use safe, minimal client-side persistence for non-sensitive session identifiers where justified.

---

# Phase E — Integrate the Existing Processing Pipeline

**This phase is essential.**

OpsPilot already has asynchronous media processing.

Preserve and extend its existing implementation.

## E1. BullMQ Integration

Ensure successfully finalised uploads trigger the existing processing workflow.

Verify:

- Correct job creation
- Idempotent enqueue behaviour
- Retry policy
- Failure handling
- Worker restart behaviour
- Processing status updates
- Job-to-MediaAsset mapping
- Duplicate-job prevention or safe repeated processing

Do not create another independent processing queue.

## E2. FFmpeg Processing

Preserve the existing video-processing capabilities.

Verify:

- Valid uploaded videos enter the processing pipeline.
- FFmpeg reads the correct stored object.
- Transcoded outputs are written correctly.
- Thumbnail generation works.
- Processing failures are visible.
- Failed jobs can be retried according to the existing policy.
- Partial output cleanup is handled.
- The final asset points to valid output objects.

Do not replace OpsPilot's existing transcoding pipeline with Mudu's simpler preview implementation.

## E3. Processing State Consistency

Ensure the UI reflects the real processing lifecycle.

Examples:

- UPLOADING
- PROCESSING
- READY
- FAILED

Adapt these states to existing conventions.

The backend must remain authoritative.

Verify that an upload cannot become READY before required processing is complete.

Ensure processing failures do not silently create unusable assets marked as ready.

---

# Phase F — Database and Storage Consistency

This is one of the most important engineering challenges.

PostgreSQL, MinIO and BullMQ are independent systems.

A Prisma transaction cannot atomically commit all three.

Design and verify explicit consistency and recovery mechanisms.

Test at least:

1. Object upload succeeds, database update fails.
2. Database record exists, object upload fails.
3. Multipart completion succeeds, API response is lost.
4. MediaAsset registration succeeds, BullMQ enqueue fails.
5. BullMQ job executes more than once.
6. Transcoding succeeds, final database update fails.
7. An object is deleted but its database record remains.
8. Database deletion succeeds but object cleanup fails.
9. Upload cancellation races with completion.
10. Background cleanup runs during an active operation.
11. NestJS restarts during finalisation.
12. Workers restart during processing.

Use an explicit recovery mechanism such as idempotent reconciliation, durable processing intent, or an existing project-supported equivalent.

Prefer the simplest design that correctly handles the identified failure boundaries.

Do not introduce Kafka, microservices or distributed transaction infrastructure.

---

# Phase G — Unified Media Library Interface

Build on OpsPilot's existing media UI.

The result should provide:

- Media listing
- File upload
- Upload queue
- Per-file progress
- Pause/cancel/retry
- Resume recovery
- Media processing status
- Media metadata
- Video preview
- Thumbnail display
- Media deletion
- Relevant asset selection
- Error and empty states

Use OpsPilot's existing design system.

Do not embed the original Mudu console UI.

Do not create a second media-management application.

## Media Preview

Use real persisted media resources.

Verify:

- Video preview
- Appropriate playback errors
- Thumbnail availability
- Resource cleanup
- Object URL lifecycle, where relevant
- Correct authorisation
- Source switching
- Browser navigation cleanup

Reuse existing media-preview components where possible.

---

# Phase H — Event and Live Streaming Integration

Media assets should be usable by the existing OpsPilot business workflows.

Evaluate integration points with:

- StreamEvent
- Event preparation
- Live Operations
- Watch Room
- BroadcastSession
- Event-associated media

Use the existing asset-selection and association patterns.

Do not create duplicate media records merely to associate an asset with multiple business contexts.

Ensure shared assets remain subject to appropriate Workspace/Event authorisation.

If a media asset is referenced by an event or broadcast, deletion should follow clear reference-integrity and cleanup rules.

## Live Streaming Boundary

Keep these concepts distinct:

- Uploaded media asset
- Transcoded media output
- Live RTMP publishing
- HLS playback
- BroadcastSession

Do not accidentally route uploaded MP4 preview through the livestream infrastructure.

Do not rebuild MediaMTX or the Live Streaming module.

Verify the existing Watch Room remains functional after media changes.

---

# Phase I — Unified Authentication and Permissions

Reuse OpsPilot's current authentication and authorisation architecture.

Do not copy Mudu's independent login or RBAC implementation.

Support:

- Workspace staff
- Authorised Event access
- Existing attendees where media viewing is permitted
- Event-scoped media associations
- Protected storage access

Verify:

1. Only authorised users can upload.
2. Users cannot manipulate another user's upload sessions.
3. Cross-workspace access is rejected.
4. Cross-event access is rejected where required.
5. Direct API requests cannot bypass permissions.
6. Direct object-storage requests respect the intended access policy.
7. Presigned URLs have appropriate scope and expiry.
8. Permission revocation is enforced at protected operation boundaries.
9. Delayed responses cannot restore inaccessible asset data.
10. Upload session identifiers cannot be used for privilege escalation.

Review the actual storage delivery boundary, not just React button visibility.

Do not expose permanent MinIO credentials or broad storage permissions.

---

# Phase J — Automated Testing

Use OpsPilot's existing testing tools.

Implement meaningful tests at multiple levels.

## J1. Upload Manager Unit Tests

Cover:

- Chunk/part calculations
- Concurrency limits
- Worker scheduling
- State transitions
- Progress calculations
- Retry
- Cancellation
- Stale callbacks
- Identity and event switching
- Resource cleanup

## J2. Backend Integration Tests

Use real PostgreSQL and MinIO where appropriate.

Cover:

- Upload session persistence
- Multipart upload
- Part tracking
- Idempotent completion
- Cancellation
- Resume
- Cross-workspace isolation
- Cross-event isolation
- Invalid files
- Storage consistency
- Reconciliation
- Cleanup

## J3. Processing Integration Tests

Use the actual BullMQ and FFmpeg pipeline.

Verify:

- Finalised uploads enter the processing queue.
- Processing jobs execute.
- Transcoded outputs exist.
- Thumbnails are generated.
- MediaAsset status becomes READY only when appropriate.
- Processing failures are recorded.
- Retry works.
- Duplicate job execution does not corrupt media state.

Use real, appropriately licensed test video fixtures.

## J4. Browser E2E Tests

Use Playwright and the real local backend.

Test:

### Scenario 1 — Complete Upload

1. Staff logs into OpsPilot.
2. Selects a valid video.
3. Uploads the video.
4. Observes upload progress.
5. Upload completes.
6. Background processing starts.
7. FFmpeg processing finishes.
8. Thumbnail appears.
9. MediaAsset becomes READY.
10. Video preview works.
11. Reload confirms persistence.

### Scenario 2 — Interrupted Upload

1. Begin uploading a sufficiently large video.
2. Interrupt the transfer.
3. Reload the browser.
4. Recover the upload session.
5. Reselect the correct local file.
6. Resume missing parts.
7. Complete processing.
8. Compare final content hashes where applicable.

### Scenario 3 — Cancellation

Cancel an active upload.

Verify browser tasks stop and backend/storage state follows the documented cancellation policy.

### Scenario 4 — Lost Completion Response

Allow completion to succeed on the server, but lose the client response.

Verify the client recovers the authoritative state without creating duplicate assets.

### Scenario 5 — Permission Revocation

Revoke upload permission during an active upload.

Verify server-side enforcement and correct client behaviour.

### Scenario 6 — Processing Failure

Inject a processing failure.

Verify job status, retry, recovery and asset consistency.

## J5. Performance Tests

Measure:

- Configured concurrency
- Transfer throughput under controlled conditions
- Browser memory usage
- UI responsiveness
- Upload progress render frequency
- Processing duration
- Repeated upload/cancel cleanup

Record actual workloads and results.

Do not invent measurements.

---

# Phase K — Existing OpsPilot Regression

The migration must not break other modules.

Run relevant regression tests for:

- Chat
- Topics
- Polls
- Permissions
- Staff authentication
- Attendee admission
- Workspace management
- Event management
- Live Operations
- SSE updates
- BroadcastSession
- MediaMTX publishing
- Watch Room HLS playback
- Existing media processing
- Existing audit logging

Pay particular attention to shared Prisma models, Docker Compose configuration, storage credentials, and background workers.

Run:

- Type checks
- Lint
- Unit tests
- Integration tests
- Browser E2E tests
- Production builds
- Relevant container startup checks
- Dependency/security checks where supported

Do not weaken existing tests.

Do not report unexecuted tests as passed.

---

# Phase L — Technical Documentation

Create:

`docs/integration/media-library-migration-report.md`

Include:

1. Previous OpsPilot media architecture
2. Verified Mudu Media Library capabilities
3. Reused versus adapted components
4. Unified data model
5. Upload session lifecycle
6. Multipart storage protocol
7. Frontend concurrency scheduler
8. Pause, retry, cancellation and resume
9. MinIO integration
10. BullMQ integration
11. FFmpeg processing lifecycle
12. Database/storage/queue consistency
13. Security and authorisation
14. Event and livestream integration
15. Performance measurements
16. Actual test results
17. Remaining limitations
18. Architecture trade-offs
19. Relevant frontend and full-stack interview questions

Include appropriate diagrams for:

- Media upload flow
- Upload state machine
- Processing lifecycle
- Failure recovery

Also update the existing OpsPilot README and developer documentation as needed.

Provide exact instructions for running and testing the integrated Media Library.

---

# Phase M — Autonomous Implementation Rules

Work autonomously through:

1. Repository audit
2. Integration architecture
3. Database changes
4. Backend multipart integration
5. Frontend upload scheduler
6. Resume/cancellation/retry
7. Existing BullMQ/FFmpeg integration
8. Media Library UI
9. Permission integration
10. Failure recovery
11. Automated testing
12. Regression testing
13. Performance verification
14. Documentation
15. Git checkpoint

Do not stop for routine design decisions.

Preserve existing working features.

Use small, verifiable Git checkpoints.

Make changes only to OpsPilot unless explicitly authorised otherwise.

Do not:

- Copy historical Mudu proprietary source bundles.
- Copy Mudu branding or private research materials.
- Replace the existing OpsPilot MediaAsset model unnecessarily.
- Introduce another object-storage service.
- Replace BullMQ without evidence of a critical problem.
- Rebuild existing FFmpeg processing.
- Introduce a second authentication system.
- Rebuild Chat, Topics, Polls or Live Streaming.
- Perform destructive database resets.
- Delete shared or production media assets.
- Expose secrets in logs, commits or documentation.
- Add microservices or unrelated infrastructure.

Escalate only when destructive actions, missing credentials, uncertain code provenance, or major scope changes require approval.

If previous integrations have unresolved P0/P1 defects affecting media integration, report the blockers and do not conceal them.

---

# Phase N — Completion Criteria

The Media Library integration is complete only when:

1. OpsPilot retains its existing authoritative MediaAsset model.
2. Real multipart uploads work with MinIO.
3. Upload concurrency is bounded and verified.
4. Upload progress is accurate.
5. Cancellation and retry work.
6. Interrupted uploads can genuinely resume.
7. Completion is idempotent.
8. Duplicate MediaAsset registration is prevented.
9. Finalised uploads enter the existing BullMQ processing pipeline.
10. FFmpeg processing and thumbnails work.
11. Processing failures and retries are handled correctly.
12. PostgreSQL, object storage and queue consistency are supported by recovery mechanisms.
13. Existing media preview and the explicitly added safe asset-deletion workflow work.
14. Workspace/Event permissions are enforced.
15. Cross-workspace and cross-event access is appropriately isolated.
16. Existing OpsPilot modules continue functioning.
17. Critical real integration and browser tests pass.
18. Type checks, linting and production builds pass.
19. Documentation is complete.
20. No unresolved P0/P1 defects remain within the integration scope.

At completion, provide:

- Implemented features
- Reused OpsPilot infrastructure
- Migrated/adapted Mudu capabilities
- Database migrations
- Upload and processing architecture
- Actual test commands and results
- Storage and consistency verification
- Security findings
- Performance observations
- Regression results
- Remaining limitations
- Git commit and branch
- Documentation paths

**STOP after the Media Library integration is complete. Do not start the final system-wide acceptance or unrelated development.**