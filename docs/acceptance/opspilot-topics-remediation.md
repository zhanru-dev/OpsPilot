# Topics acceptance remediation

Date: 29 October 2026. Scope: P1-01 and P2-01 from [the independent acceptance report](opspilot-topics-integration-acceptance.md). Reviewed application baseline: `a5bb2ca`; historical audit/evidence checkpoint: `26c0934`. Destination branch: `feat/streamops-chat-integration`.

This is the implementation and verification record for the user-authorized fixes. The original independent **FAIL** report remains intact. No schema migration, authorization redesign, other-module migration or Mudu source change was made.

## Plan recorded before implementation

1. Keep the original operation ID after an ambiguous create/reply outcome, including subsequent HTTP rejections. Observe the server's Retry-After deadline without bypassing authentication or throttling. Verify staff and attendee roots and replies using real commits, deliberately lost responses and actual HTTP 429 responses.
2. Own edit drafts above invalidated cards. Keep the original version until the user explicitly reviews the current question. Continue hiding unverified rows; remove drafts when a verified window no longer contains an editable parent, access changes, or actor/event scope changes.
3. Add focused state and browser regressions, then run type checks, lint, builds, API/database/WebSocket suites and existing Topics/Chat/Polls/application browser regressions against isolated test infrastructure.
4. Record actual outcomes, limitations and reviewable Git checkpoints. Do not repair unrelated modules.

## P1-01: uncertain submissions retain their identity

**Fixed and reproduced successfully against the real backend.** The shared question/reply composer now keeps an already-unconfirmed operation through subsequent rejections, including 429, 403 and 409. A rejection of a later attempt does not prove an earlier attempt failed. The frozen operation contains both its original ID and original text. Successful confirmation clears it; the explicit **Discard retry** action remains available with its warning to check previously delivered content.

Initial definitive validation/authorization failures still allow correction. Network errors, 5xx, 408 and 429 preserve the attempt. HTTP 429 cannot turn **Retry question/reply** back into a new submission silently. No backend idempotency, permission check or throttle is bypassed.

`ApiError` now carries an optional Retry-After deadline parsed from either seconds or an HTTP date. Nest exposes only that additional response header to the configured web origin. The composer displays a countdown and disables retry until the deadline, retaining the deadline across card remounts. Its timer is cleaned up on unmount. Invalid/missing Retry-After does not invent a waiting period; identity retention still applies.

Implementation: [draft state rules](../../apps/web/src/features/topics/drafts.ts), [composer](../../apps/web/src/features/topics/topics-panel.tsx), [API client](../../apps/web/src/lib/api.ts), [CORS configuration](../../apps/api/src/configure-app.ts).

| Real browser scenario | Responses received by test transport | Stable operation IDs | Final PostgreSQL rows for the intent |
| --- | --- | --- | --- |
| Staff question | 201 (response dropped), 429, 201 | 1 | 1 |
| Staff reply | 201 (response dropped), 429, 201 | 1 | 1 |
| Admitted attendee question | 201 (response dropped), 429, 201 | 1 | 1 |
| Admitted attendee reply | 201 (response dropped), 429, 201 | 1 | 1 |

Each test consumes the actual controller throttle budget using one repeated warmup ID, commits the target through Nest/PostgreSQL, drops only its response, then obtains a real 429. The browser countdown/disabled button proves Retry-After is available through CORS. Tests wait for the real deadline, retry, and query PostgreSQL. Neither 201 nor 429 is fabricated. All four scenarios passed in the production frontend run; each takes approximately 1.1 minutes because the real throttle window is retained.

## P2-01: edits survive temporary row invalidation

**Fixed and verified with independent authenticated browsers.** Edit drafts now belong to the actor/event scope above snapshot cards. Content-free notifications still immediately hide the affected server row. Such a notification does not erase a user's local draft. Only a verified replacement window or authority loss decides whether the draft remains eligible.

The draft retains its original `expectedVersion`. An incoming reply, approval or edit advances the parent version; the UI keeps the text, shows the current question, and disables saving until the user chooses **Keep draft against current version**. This is an explicit review/rebase, not an automatic overwrite. A newer race is still rejected by the existing database-backed version check. Pinned questions cannot be saved until unpinned.

The verified-window reconciliation discards editors for removed/noneditable parents and changed authority. Switching event/identity remounts the scope. Denied access clears the verification window. The existing hidden-during-recovery and stale-response fences remain in place. No permission is inferred from draft ownership.

Implementation: [scope and conflict controls](../../apps/web/src/features/topics/topics-panel.tsx), [verified window lifecycle](../../apps/web/src/features/topics/use-topics.ts), [draft reconciliation](../../apps/web/src/features/topics/drafts.ts).

Executed browser checks:

- Another staff member replies while an editor has unsaved text: draft survives card invalidation; parent/reply remain consistent.
- A direct PATCH with the original version returns 409 and leaves stored text unchanged. Explicit review then permits saving the retained draft.
- Another moderator edits the root: local text survives, current server text is shown, and Save is disabled until review.
- Deleting the root removes the editor and active replies; refreshing does not resurrect it.
- Approving an attendee's pending root preserves that author's draft and requires version review.
- Disabling audience publishing removes the editor. Re-enabling starts from canonical text, not the discarded private draft.
- Revoking the attendee session removes the topic UI. A different admitted identity cannot recover the draft or edit the previous author's root; direct PATCH returns 403.

## Test environment and actual commands

macOS x86_64; Node 22.20.0; npm 10.9.3; installed Chrome via Playwright; Nest/Next production build. Existing PostgreSQL 17 at port 5546 hosts the **new** `opspilot_topics_remediation_20261029_test` database. Dedicated Redis container `opspilot-topics-remediation-redis-20261029` uses port 6393. Storage uses a separate `opspilot-topics-remediation-20261029` bucket on local MinIO. Mailpit uses ports 8025/1026; only uniquely addressed test mail is read.

The new database was migrated and seeded once. No shared database was reset/reseeded and no existing user upload was deleted. Existing owned development supervisor PID 64513 was verified before pausing it for the suites' fixed ports. Mudu remained at `7bd9a2f`, with its existing untracked streaming audit files unchanged.

Commands were executed through the ignored recording wrapper:

```sh
node .runtime/topics-remediation/run.mjs <label> <command-and-arguments>
```

It invokes `scripts/with-chat-test-env.mjs`, then a child `env.mjs` that replaces DATABASE_URL, REDIS_URL and S3_BUCKET with the isolated resources above. The child override is essential: the stock wrapper otherwise selects `opspilot_chat_test`. No credentials or raw authentication traces are published in the evidence.

| Command after environment wrapper | Actual result |
| --- | --- |
| `npm run db:deploy` | PASS, all current migrations applied to the new database |
| `npm run db:seed` | PASS, new isolated database only |
| `npm run typecheck` | PASS, API + web |
| `npm run lint` | PASS, API + web |
| `npm test -- --runInBand` | PASS, 94 tests / 15 suites |
| `node --import tsx --test tests/chat-state.test.ts tests/topics-state.test.ts tests/topics-drafts.test.ts` | PASS, 15 tests, including 5 new draft/retry tests |
| `npm run test:e2e --workspace=@opspilot/api -- --runInBand` | PASS, 60 tests / 5 suites, real PostgreSQL/Redis/WS |
| `npm run build` | PASS, Nest + Next production build |
| `env E2E_PRODUCTION_WEB=1 npm run test:ui` | PASS, 22 real-browser tests, 7.1 minutes; 6 new regressions |
| `env CHAT_RECOVERY_PRODUCTION_WEB=1 npm run test:chat:recovery` | PASS, 12 staff/attendee recovery tests, 1.5 minutes |
| `npm run test:ui:isolated` | PASS, 12 tests; mocked HTTP UI supplement only |

Permanent regressions: [Topics browser tests](../../e2e/topics.spec.ts) and [draft state tests](../../tests/topics-drafts.test.ts). `npm run test:topics:state` now includes the draft tests. `npm run test:topics:browser` includes all Topics workflows, including the four real throttle waits. Browser assertions were added rather than weakened.

## Regression status and boundaries

- **Topics:** complete normal workflow, staff/attendee sockets, lost create/reply responses, duplicate/delayed notices, pagination, stale delete snapshots, event switching, moderation/settings, concurrent changes, parent consistency and the new failures pass. Existing real API tests preserve authorization, private delivery, event isolation and concurrent pinning coverage.
- **Chat:** both main-suite workflows pass, including persistence/moderation and disconnect replay with older scroll anchor, unread/bounded rendering. All 12 staff/attendee fault-recovery tests also pass, including real PostgreSQL timeouts, reconnection, replay failures, ticket renewal and revoked-session denial.
- **Polls / Live Operations:** manager/analyst live poll synchronization, launch-readiness flow and read-only role surfaces pass in the real browser suite.
- **Authentication / admission / permissions:** existing API suites and real registration/verification/signout/restricted invitation/revocation browser workflows pass.
- **Existing media:** existing API and reliability-screen regression coverage passes; this was not a new upload/storage acceptance audit.

No database changes were needed: the original unique operation keys and expected-version transaction checks already worked. The fixes preserve those server-side guarantees through the client lifecycle. No new dependencies, sockets, global state library or application shell were introduced.

## Limitations and trade-offs

- Local drafts and uncertain operation IDs remain in memory; a full reload does not restore them. Committed content is retrieved from the backend after reload. Check it before starting a new intent. Durable encrypted drafts/receipts would require a separate lifecycle design.
- Edit drafts are retained only while their parent remains editable in the current verified loaded window. Filter changes, falling outside that window, deletion and authority changes discard them conservatively. They are not a cross-view draft archive.
- Any parent version change, including a reply/approval, requires explicit review before saving. This is deliberately conservative; the existing server version is shared by parent and reply activity.
- Explicitly discarding an uncertain retry can lead to a separately submitted intent; the UI warns about this. Retaining an uncertain ID through later 403/409 does not grant permission to retry successfully.
- Real throttling tests are slower and run sequentially because limits are currently IP/handler scoped. This fix does not change that policy.
- No production deployment, multi-replica capacity, extended performance soak or new streaming/media acceptance claim is made. Previous audit findings outside these two issues retain their documented scope.

## Checkpoints and conclusion

**PASS for the targeted P1-01/P2-01 remediation.** Both defects are closed in the executed scope; no unresolved P0/P1 defect was observed in these fixes. This is not a replacement independent audit of untested deployment scenarios.

- `26c0934`: original independent FAIL report and evidence.
- `349ea30`: application fixes, 5 new state tests and 6 new browser regressions.
- Final report/evidence: the documentation checkpoint containing this file.

[Structured results and exact recorded commands](opspilot-topics-remediation-evidence/results.json), [browser results](opspilot-topics-remediation-evidence/browser-results.txt), [API results](opspilot-topics-remediation-evidence/api-results.txt), [Chat recovery results](opspilot-topics-remediation-evidence/chat-recovery-results.txt), and [evidence hashes](opspilot-topics-remediation-evidence/sha256.json) are committed. Raw logs/traces stay ignored because they may contain session traffic.

Both the web login and API readiness endpoints returned HTTP 200 after restoration. The owned normal development stack was restored using the original `opspilot_chat_test` configuration (supervisor PID 70770). Dedicated remediation Redis was stopped after all suites; its container and the isolated database/bucket remain for reproduction. No next module was started.
