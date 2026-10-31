# Media Library integration plan and contracts

Task: [approved prompt](media-library-integration-task.md). Plan recorded before Media integration code changes. Prerequisite gate completed: 77c5fd9. See the streaming remediation report for 71 API, 106 unit, 15 state and 51 browser test passes (39 real workflows plus 12 isolated UI cases; the additional one-off media probe also passed).

## Baselines and source mapping

- Destination: OpsPilot, `feat/streamops-chat-integration`; original reviewed implementation `f68717b`, audit preserved at `4259e58`, approved updated task `e933a88`. Existing uncommitted changes are the authorized streaming remediation, not a clean integration baseline.
- Source: `/Users/ruzhan/computer_science/projects/mudu-engineering-showcase`, `7bd9a2f`. Existing untracked live-acceptance report/evidence are untouched.
- Read source `apps/web/src/features/media/queue.ts`, storage/service/contracts and media technical review plus acceptance/fixes reports. Valuable patterns: immutable operation identity, synchronous worker reservation, bounded chunk hashing, generation fencing, authoritative readback and durable cleanup. Source evidence distinguishes newly authored implementation from historical captured client behavior. No historical bundles/research/branding will be copied.
- OpsPilot already owns MediaAsset, MediaUpload, MediaProcessingJob/Attempt/Variant, EventMediaAsset, direct S3 PUT/read URLs, two BullMQ media workers, real FFmpeg, outbox/webhook delivery, queue recovery and cleanup. MediaUpload is extended, not duplicated. Existing MP4/MOV and MP3/WAV/M4A profiles stay supported.

## Product and permission contract

Staff workspace media management only. ADMIN/OPERATIONS_MANAGER/CONTENT_OPERATOR may upload and manage assets. All current workspace members may list/preview. Session and membership are verified from PostgreSQL at protected boundaries, using the existing staff principal. New upload sessions belong to verified user IDs; owner may resume/cancel, ADMIN/OPERATIONS_MANAGER may cancel another owner's session but cannot silently resume it with different bytes. CONTENT_OPERATOR cannot operate another owner's unfinished transfer. Attendees receive no workspace library access. Existing event association checks both resources in the workspace; shared assets may legitimately be used by multiple authorized events.

Unreferenced assets may be deleted; referenced assets return409 until explicitly detached. Processing deletion is fenced so later workers cannot resurrect assets. Seeded demo records remain visibly identified and are not used as evidence of real processing. No recording/replay/Watch Room media publication, attendee uploads, Chat/Topics attachments, or livestream insertion.

## Additive data model

Extend MediaUpload with optional owner/operation identity for backward compatibility, immutable source manifest (ordered part hashes/length derived from total bytes and fixed part size), multipart storage ID, finalization/cleanup/reconciliation metadata. Add persisted part receipts only where needed. New operation uniqueness is workspace+owner+client operation; same key with different payload returns409. Existing single-PUT rows remain readable and completable. MediaAsset keeps its initial identity and gains source digest/cleanup state as needed. Preserve all existing rows, IDs and event references.

Separate client queue state (queued/hash/upload/pause/finalize/error), upload state (pending/finalizing/uploaded/cancelled/expired), asset state (uploading/processing/ready/failed/deleted) and processing job states. No transfer percentage implies READY.

## API and storage contracts

Existing `/media-assets` routes retained. New multipart routes under `/media-assets/multipart`:

| Route | Contract |
| --- | --- |
| POST / | Immutable clientOperationId, name, kind, contentType, sizeBytes and ordered SHA-256 hashes; reserve the one asset/session; repeated matching requests return the same receipt |
| GET / | Current owner's open sessions first, bounded terminal history; unfinished work cannot be displaced by completed history |
| GET /:id | Authorized server state and confirmed part receipts; storage state cross-checked before reuse |
| POST /:id/parts/:number | Short-lived URL bound to object/upload/part/checksum/size; current permission and owner check |
| POST /:id/parts/:number/confirm | Validate storage receipt against immutable manifest; duplicate confirmation safe |
| POST /:id/complete | Deterministic finalization; one processing intent; repeated/lost responses recover the same asset |
| POST /:id/cancel | Cancel wins before committed finalization; otherwise returns authoritative uploaded result; durable cleanup |
| DELETE /media-assets/:id | Current management rights, no active event references; tombstone and retryable original/derivative cleanup |

Use existing private MinIO, S3 multipart API and server-generated object keys. Default 5 MiB non-final parts, 100 MiB file limit and bounded open sessions. Browser computes per-part SHA-256 sequentially with bounded buffers; reselect requires matching content manifest. Server validates lengths, receipts and source integrity. Presigned URLs never enter persistent browser metadata or logs. TTL and inflight grants remain a documented revocation window; revocation blocks fresh grants and finalization.

## Concurrency and recovery

Serialize conflicting operations by resource identity in PostgreSQL. Persist finalization intent before external storage completion; completed object without DB success can be verified and committed on retry. Keep finalization/cancel winner deterministic. Never assume PostgreSQL, MinIO and Redis share a transaction.

Commit one processing intent before enqueue using stable job identity. Extend existing queue/cleanup reconciliation to recover missing jobs and durable cleanup. Keep correlation separate from logical idempotency (the preceding P1 repair). Repeated worker execution/DB failure must not duplicate variants or publish deleted assets. Cleanup must recheck state under the same lock and fairly revisit failed work. Missing objects produce an explicit unavailable/failure state; transient storage errors do not permanently delete metadata.

Frontend starts with three file workers, one sequential part transfer per worker (aggregate at most three transfers), synchronously reserving slots. Pause/navigation aborts local transfer and retains server receipts; reload reselects file. No global state library. Scoped queue generation prevents stale callbacks after logout/workspace changes. Progress reports confirmed bytes separately from transient transfer and processing. UI keeps OpsPilot layout, listing, preview, metadata, event selection and retry controls.

## Verification and checkpoints

1. Prerequisite remediation: real pipeline, failure/retry/outbox, migration preservation, prepare409/lost receipts, original APIs/browser/state regressions, build/lint/type.
2. Schema/storage/backend: fresh and old-data migration checks; real PG/MinIO multipart/permission/duplicate/concurrent completion/cancel/recovery tests; current-session and cross-workspace denial.
3. Worker/cleanup: real Redis/FFmpeg video and audio, enqueue loss, duplicate processing, DB commit failure, missing bytes, deleted asset fencing and cleanup failures/restart.
4. Frontend/browser: real upload/decode, simultaneous delayed transfers, pause/retry, reload/missing-only resume, wrong same-size file, lost completion, revoke, cancellation/finalization and preview teardown. Unit scheduler tests cover generations, fairness and no slot leaks.
5. Regression/measurements: existing Chat, Topics, Polls, admission/auth, events/permissions, SSE/Live Operations and real broadcast suites; declared local throughput/memory/render work; type/lint/build. Critical unverified requirements block completion; limitations remain explicit.

All destructive fixtures belong to isolated test DB/bucket/Redis. Restore the owned development stack after testing. Write migration report with exact executed commands/results and stable checkpoints; stop before independent system-wide acceptance.

### Finalization and scope details

- A database resource lock serializes initialization retry, receipts, completion, cancellation and expiry. Reserve IDs/manifest first; external multipart initialization with a lost response is reconciled by the exact server-owned key. Never scan or delete another key's uploads.
- Persist FINALIZING before external completion. The following locked operation accepts an already completed object only after validating its exact length and ordered source hashes; commit uploaded state and the unique processing intent together. If storage succeeds but DB fails, keep FINALIZING and recover from the stored original. A cancel that commits before upload registration leaves a tombstone; later completion cannot publish it. A cancel after registration returns UPLOADED and does not delete that asset.
- Short-lived part grants bind expected hash/length and part identity. Server receipt confirmation cross-checks S3. Post-completion verification protects against delayed/overwritten parts; an integrity failure never enters FFmpeg processing.
- Active transfer sessions are capped per owner/workspace. Grant TTL, upload-session expiry and terminal-receipt retention are different concepts. Resume reads every bounded open session before terminal history. Cleanup waits/retries for possible inflight storage grants and records durable outcomes.
- Deletion of a referenced or actively processing asset may be rejected with409; that is an intentional, visible business rule, not silent cancellation. Underlying worker commits still check current asset/job ownership to prevent stale work from publishing deleted or superseded state.
- Navigation away pauses local work and releases file/controller references. Closing only the upload dialog may leave page-owned work running. Reload requires reselect for missing bytes, while an already finalizing/completed session can recover its authoritative outcome without uploading again. Logout/workspace changes dispose the old manager and clear private view state.
- No new media WebSocket infrastructure: use the existing query/cache conventions and bounded polling for processing status, with current permission revalidation. Existing Chat/Topics/Broadcast WebSocket and operations SSE remain unchanged.
