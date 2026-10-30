# Live streaming integration plan and contracts

30 October 2026. Destination baseline `bf35f83`, clean, branch `feat/streamops-chat-integration`. Source baseline `7bd9a2f`; its pre-existing untracked streaming audit/evidence remain untouched. Scope is the [updated task](live-streaming-integration-task.md).

## Source review and adaptation

Mudu LS-01 is fixed in `bf0b5c0`: select ACTIVE first, otherwise immutable createdAt/id ordering; selected row revision may be below snapshot revision. LS-02 is fixed in `c569af8`: callback Basic authorization with masked transport URLs; finalized connection-refusal tests at `5c205bc`. Current code, config and remediation evidence match those fixes. This inspection is not a fresh execution of the source suite. Independently authored service/reconciliation, HLS relay validation and player ownership patterns may be adapted; no historical captured bundles, old auth models, branded pages or research files are copied. Source reports remain source-only references.

## Domain and authorization

StreamEvent remains authoritative. Existing LiveSession (one operational session per event) and Polls are unchanged. Add BroadcastSession(s), BroadcastGrant and BroadcastPublisher. No media bytes in PostgreSQL.

| Event state | Staff metadata view | Manage/start video | Publish / playback | Attendee interaction |
|---|---|---|---|---|
| DRAFT / CONFIGURING | yes, current members | no | no | existing admission denies |
| READY | yes | ADMIN / OPERATIONS_MANAGER | publish ADMIN / OPERATIONS_MANAGER / CONTENT_OPERATOR; view all current staff and admitted attendees | Chat/Topics available; Polls wait for operational LIVE |
| LIVE | yes | same | same | current Chat/Topics/Polls policies |
| COMPLETED / ARCHIVED / CANCELLED | historical metadata | no new start; operators may end/clean up existing session | no | existing admission denies |

`manage` and `publish` differ: a CONTENT_OPERATOR can publish to an operator-prepared session but cannot start/end it. Read historical metadata does not grant playback. Attendees never receive publishing or management credentials. Every REST/WS/media operation revalidates EventIdentityService against current Session, WorkspaceMembership, attendee session/registration/invitation/policy. Authority fingerprint includes current role, event status and policy. Publishing grants bind to the verified staff principal/session and broadcast; playback grants additionally require the same authenticated browser principal on every resource request.

Stopping a broadcast does not transition StreamEvent or LiveSession, close Polls, or remount Chat/Topics. Completing/cancelling the business event denies subsequent media requests and reconciliation retires its active broadcast. Existing Live Operations remains responsible for going LIVE and opening Polls.

## Model and state invariants

- StreamEvent.broadcastRevision: monotonic event snapshot revision (integer, overflow refused).
- BroadcastSession: UUID; event FK; creator FK; clientOperationId; ACTIVE/ENDED lifecycle; WAITING/LIVE/INTERRUPTED/UNKNOWN availability; revision; immutable createdAt; firstLiveAt; endedAt; checkedAt; source connection id; cleanupPending. Unique (event,creator,operation); partial unique event WHERE ACTIVE; checks for lifecycle/timestamps/revision.
- BroadcastGrant: hash-only opaque random credential; kind PUBLISH/PLAYBACK; session FK; verified EventPrincipal JSON; expiry. Principal is exclusively server-created and revalidated, not a role claim. Grant deletion cascades publisher mapping; expiry/session checks remain authoritative.
- BroadcastPublisher: MediaMTX RTMP connection UUID to grant FK; createdAt. Delayed callbacks cannot attach to retired sessions.
- Session selection: ACTIVE first, else createdAt DESC/id DESC. Revision orders observations, never determines newest session identity.
- Start/end under event FOR UPDATE and current authority locks, idempotent retries. Reads/grants use appropriate event locks. External network work only after transaction commit. A captured session revision fences delayed observation writes.
- End commits ENDED + revokes grants + cleanupPending first. Failure to kick does not undo the end. Background bounded batches recover pending cleanup after process restart. Media control failure gives UNKNOWN, never evidence of LIVE/offline. No physical disconnect claim while control is unavailable.

## REST / WebSocket contract

Staff base `/api/v1/stream-events/:eventId/broadcast`; admitted attendee base `/api/v1/public/events/:eventId/broadcast`.

| Method/path | Contract |
|---|---|
| GET base | `{enabled,eventId,revision,context,session}`; authenticated metadata snapshot, active-first selection |
| POST /ticket | existing Redis single-use channel-bound ticket, 30s, channel=broadcast |
| POST /sessions | staff manage; `{clientOperationId,expectedRevision}`; idempotent canonical snapshot |
| POST /sessions/:id/end | staff manage; `{expectedRevision}`; repeat ended result safe |
| POST /sessions/:id/publish-key | staff publish; newly generated key, expiry, RTMP server; replaces only this login's previous key |
| POST /sessions/:id/playback | view; scoped ticket/path/expiry; 120s default, renew before expiry; max bounded grants per login |
| GET /sessions/:id/hls/:file | same principal + playback ticket; every resource reauthorized; bounded playlist rewrite and streaming binary relay |
| POST /playback/release | authenticated owner-only best-effort ticket release; expiry is fallback |
| POST /internal/broadcast/auth | MediaMTX-only Basic callback; tightly validated action/protocol/path; no user session substitution |

Existing `/chat` Gateway gains channel `broadcast`; events `broadcast.ready`, `broadcast.snapshot`, `broadcast.denied`, `broadcast.unavailable`. Sends no credentials. Delivery reauthorizes current scope; 3s idle checks plus 5s client snapshot repair. Existing channel command handlers remain isolated. REST is authoritative; old event/revision/authority responses cannot overwrite current scope. Transient failures obtain fresh tickets and recover, true access loss clears private state.

## Media / security boundary

Pinned MediaMTX 1.21.3, fMP4 HLS, 1s target segments, single H.264/AAC RTMP publisher; no recording/other protocols. Validate against tagged implementation. Separate opt-in Compose service using nonconflicting loopback ports, private control/HLS credentials and authenticated callbacks. Browser fetches through Nest HLS relay, never direct privileged MediaMTX URLs. Authentication covers variants/init/segments; redirects restricted to same upstream origin/path and known reader-session query. Cache-Control private,no-store; Referrer-Policy no-referrer. Cross-origin browser requests use existing WEB_ORIGIN and credentials; native player and hls.js must use cookie-bound URLs.

HLS uses a bounded endpoint-specific high request budget plus per-process streaming-slot bounds, upstream timeouts and backpressure; management keeps existing low API budgets. Callback requests have their own bounded budget. No global throttle bypass. Raw secrets never in persistent error records; sanitize credential-bearing URL queries and credential strings before capture. Probe real refused/timeout/503 diagnostics. Development secrets generated in ignored files with 0600 permissions; do not print rendered Compose config or publisher command lines. Rotation supported by setup utility, never automatic against existing shared secrets.

## Frontend boundaries

Dedicated BroadcastPanel/useBroadcast/LivePlayer under App Router, existing design tokens/buttons. Staff panel inside Live Operations. `/events/[id]/watch` resolves existing attendee session, has admission recovery/logout and composes existing ChatPanel, TopicsPanel, AttendeeLivePolls. Confirmation page links to Watch Room without removing existing working interactions. Actor/event keyed scope; cache cleanup on session loss; player keyed by selected broadcast only. Source renewal/reconnect cannot reset sibling interactions. Bounded media recovery; play() results fenced by effect ownership; destroy hls.js, abort requests, clear timers/listeners, release tickets on unmount. Native video controls provide keyboard-accessible playback/volume/fullscreen.

## Predeclared local verification gates

Dedicated database `opspilot_broadcast_test` at existing test PG5546, dedicated Redis6394, bucket `opspilot-broadcast-test`, separate MediaMTX RTMP1937/HLS8890/control9999. Do not alter Mudu's ports1935/8888/9997. New database only is seeded once; test cleanup removes own fixtures. Existing application tests keep their usual isolation. Verify current owned development PID before stopping fixed-port services; restore at handoff.

Mandatory Chromium H.264/AAC real decoding (advancing currentTime and decoded frames), not just HTTP200. Local gates with publisher already producing frames: startup <=20s, stream interruption observation <=10s, recovery after healthy reconnection <=25s; healthy publisher revocation kick <=10s; new REST/media requests denied immediately following committed revocation. Already buffered bytes cannot be recalled. At least 3 startup/recovery observations; record workload and raw elapsed values. Two simultaneous viewers and >=2 real playback renewal cycles (test-only short TTL allowed only NODE_ENV=test) cross default throttle windows. Test interruption, process restart, media restart, auth outage, old cleanup after replacement, stop during control outage, lost start/end responses, concurrent starts, cross-workspace/event/identity, source switching, autoplay rejection and teardown. Temporary infrastructure faults must recover without reload; genuine revocation must not recover access.

Run existing unit/state/API/real-browser suites, Chat recovery, typecheck/lint/build and relevant container startup checks. Safari/iOS/native-HLS is implemented best effort but NOT VERIFIED without actual available browser; not a gate for this explicitly scoped local Chromium release. No production/multi-replica/soak claim.

## Checkpoints

1. Updated task + architecture/contracts before implementation.
2. Additive schema + Nest/media authorization/reconciliation + unit/integration coverage.
3. Gateway + player + Watch Room/operations integration.
4. Real streaming, adversarial/browser/regression fixes and evidence; final migration report.

No implementation completion claims yet. Stop after Live Streaming; Media Library enhancements excluded.
