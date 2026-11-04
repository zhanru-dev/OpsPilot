# Live Streaming acceptance remediation

Scope: P1-01, P2-01 and P3-01 from the [preserved acceptance report](opspilot-live-streaming-watch-room-acceptance.md), reviewed implementation `f68717b`. The historical FAIL report and its evidence stay intact.

## Focused plan and contracts

1. **P1:** `traceId` is correlation, not an event/job/delivery identity. Replace its unique indexes with ordinary indexes; preserve all row IDs, foreign keys and unique `(domainEventId, endpointId)` deliveries. Add nullable `DomainEvent.idempotencyKey`; media lifecycle events use `media:<processingJobId>:<phase>`, transactionally creating one outbox row. Existing data remains unchanged. Verify real upload/transcode/preview, invalid input/terminal failure, retry, duplicate completion and multi-subscriber outbox delivery using PostgreSQL, Redis and MinIO. Provide an opt-in recovery command for specifically identified stale jobs; default dry-run, no file deletion or shared-data reset.
2. **P2:** preserve prepare operation identity after uncertain responses, while retrying against the current verified event revision. The backend checks idempotency before revision, so a lost success response still resolves to the original session. Add a real409 Refresh/Retry browser test and retain lost-receipt/replacement coverage.
3. **P3:** correct the documented end limit to the existing global100/min policy; no throttle-policy change.
4. Use isolated remediation infrastructure; rerun existing API, Chat/Topics state, browser interaction/recovery, lint/type/build checks. Restore the owned development stack after compatible migrations and create small Git checkpoints. Do not migrate another module.

## Implementation and verified evidence

- P1 implementation checkpoint `928405b`: trace correlation indexes, stable job/phase event keys, atomic event/outbox idempotency, targeted dry-run-first repair command. No shared historical jobs were automatically changed. Real PostgreSQL/Redis/MinIO/FFmpeg tests cover valid original hash, two registered variants, READY/SUCCEEDED, duplicate processing, failure across three attempts, explicit legacy-state repair, same-trace retry and two webhook subscribers (four real deliveries).
- P2/P3 implementation checkpoint `ecbb7d4`: current snapshot revision on intentional prepare retry while retaining operation identity; documented end limit corrected to100/min. Four broadcast browser workflows passed, including real409→Refresh→201, same operation identity, lost start/end responses and replacement isolation.
- Updated next-phase task checkpoint `e933a88` explicitly requires this gate to finish before Media integration.

Environment: macOS x86_64, Node22.20.0, real PostgreSQL on5546 (`opspilot_live_fix_20261031_test`), dedicated Redis6398 (`opspilot-live-fix-redis-20261031`), dedicated MinIO bucket `opspilot-live-fix-20261031`, local FFmpeg/Chrome/MediaMTX. Only isolated fixtures are mutated/deleted. Prior audit DB/bucket/evidence remain intact. Logs live in ignored `.runtime/live-remediation-20261031/`; environment wrapper contains local test routing, with separate0600 generated secrets excluded from Git.

### Commands executed so far

```sh
npm run lint
npm run test -- --runInBand
npm run test:chat:state
npm run test:topics:state
node .runtime/live-remediation-20261031/env.mjs npm run build
npm run typecheck
node .runtime/live-remediation-20261031/env.mjs node .runtime/live-remediation-20261031/check-migration.mjs
node .runtime/live-remediation-20261031/env.mjs npm run test:e2e --workspace=@opspilot/api -- --runInBand
node .runtime/live-remediation-20261031/env.mjs env BROADCAST_ENABLED=false E2E_PRODUCTION_WEB=1 npx playwright test e2e/media-processing.spec.ts --trace=off --output=.runtime/live-remediation-20261031/media-browser-results
node .runtime/live-remediation-20261031/env.mjs npx playwright test --config=playwright.broadcast.config.ts --output=.runtime/live-remediation-20261031/broadcast-results
npm audit --omit=dev --registry=https://registry.npmjs.org --json
```

Results: lint/type/Nest+Next production build pass;16 unit suites/106 tests;15 Chat/Topics state tests; migration preserves all original-column row counts/digests across43 tables with8 representative existing rows (including media/job/event). Single real upload/preview browser probe passed in41.5s (test6.4s); four broadcast tests passed in2.5m. Official npm production dependency audit reports zero advisories at execution time; configured mirror lacks the audit endpoint, so that initial attempt failed and was replaced by an explicit official-registry check.

First full API run:70 passed,1 Topics WebSocket visibility test exceeded the default5s Jest timeout. No production/test assertion was changed for that failure. Second full run: all7 suites/71 tests passed in89.939s, including the same Topics test. Preserve both `api.log` and `api-rerun.log`; this is a timing-sensitive initial failure, not a claim that every run passed. Earlier compile/lint checks caught an inferred recursive return type and test typing issues, corrected before the successful checks above.

### Completed regression and prerequisite decision

Additional exact commands (same isolated wrapper):

```sh
node .runtime/live-remediation-20261031/env.mjs env BROADCAST_ENABLED=false E2E_PRODUCTION_WEB=1 npx playwright test --trace=off --output=.runtime/live-remediation-20261031/regression-results
node .runtime/live-remediation-20261031/env.mjs env BROADCAST_ENABLED=false npx playwright test --config=playwright.chat-recovery.config.ts --output=.runtime/live-remediation-20261031/recovery-results
node .runtime/live-remediation-20261031/env.mjs env BROADCAST_ENABLED=false npx playwright test --config=playwright.ui.config.ts --output=.runtime/live-remediation-20261031/ui-results
```

- Full real browser/business regression:23/23,7.5m. Staff/attendee Chat, pagination/replay/moderation, Polls, Live Operations, authentication/admission/revocation, media upload/preview and all Topics visibility/concurrency/429/draft/reconnect workflows pass. Uses production web build.
- Chat fault recovery:12/12,2.3m. Both actors recover real PostgreSQL timeouts during subscribe/reconnect, temporary gateway failures, renewed tickets and transient legacy errors; revoked sessions cannot retrieve private history. This run uses the development web server, as selected by the actual command.
- Isolated UI regression:12/12,39.5s. These mocked UI cases are reported separately and do not substitute for real integration evidence.

**Prerequisite gate passed for the three reported findings.** P1-01, P2-01 and P3-01 are closed by this implementation follow-up; the historical independent FAIL report is unchanged. This is not a new independent system-wide acceptance. The authorized Media Library integration may now start from the repair checkpoints.

Remaining limits: local single-host Chrome evidence; no new Safari/native-HLS, production-scale or prolonged-soak claim. Existing historical stranded jobs require the explicit scoped recovery command; none were automatically altered. The original development supervisor remains paused while the newly authorized integration owns fixed test ports; restore it with compatible migrations and no reseed at integration handoff. The prior audit's data/evidence and Mudu source are untouched. All test servers exited and3000/4100 were free at this checkpoint.


