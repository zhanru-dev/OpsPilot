# Final-system acceptance evidence — 2026-11-03

Reviewed application: `516f2a31242c615ab6858dc6472438aa38f13e00`, `feat/streamops-chat-integration`. Overall **FAIL**. See [report](../opspilot-final-system-acceptance.md), [defects](../opspilot-final-defect-register.md), [remediation plan](../opspilot-remediation-plan.md).

These are fresh isolated audit observations, not copies of prior passing summaries. Application source/schema/migrations were not modified. Tests using infrastructure, mock UI, state logic and diagnostic fault probes are deliberately distinguished.

## Index

| Evidence | Meaning |
| --- | --- |
| `baseline-environment.json`, `versions.json`, `ffmpeg-versions.json` | Tested versions/services; no private environment values |
| `source-comparison.json` | Final byte comparison of 278 application/schema/manifest files against reviewed Git commit |
| `adaptations.json`, `verification-adaptations.patch` | All 22 existing test/config/script adaptations in ignored execution copy; ports/owned services/image identity and production Web startup only; assertions retained |
| `commands.jsonl` | Child command, arguments, start, exit, elapsed seconds; includes failed/aborted attempts, not a PASS-only list |
| `lint.txt`, `typecheck.txt`, `build.txt`, `unit.txt`, `state.txt` | Quality/build; 106 unit and19 state tests |
| `baseline-broadcast-api.txt`, `media-restart-isolated-recheck.txt` | Initial101/1 API result and separate passing restart test;102 unique tests eventually have passing evidence |
| `browser-regression-rerun.txt`, `chat-recovery.txt` | 27 real browser regressions +12 recovery cases |
| `isolated-ui.txt` | 12 mock-API UI cases; not proof of real persistence or transport |
| `browser-broadcast.txt`, `browser-broadcast-end-recheck.txt` | Initial3/1 browser streaming result; unchanged failed case repeated3 times passed; timing defect still present |
| `broadcast-race-results.json`, `browser-broadcast-controlled-race.txt` | Deterministic real-GET delay reproduces enabled stale retry409, then valid201 |
| `journey-results.json`, `browser-journey-final.txt` | One same-event end-to-end journey, actual uploaded asset and real livestream |
| `live-audio-results.json`, `broadcast-live-audio.txt` | ActualAAC viaRTMP/HLS into ChromiumAudioContext; nonzeroRMS, speaker gain0 |
| `security-results.json` | 24 observations,10 failures spanning2P1+refreshP2; no cookie/token values |
| `topic-race-results.json` | Two authenticated moderators; approve/approve and six approve/delete orderings;14 checks |
| `infrastructure-results.json` | OwnPG/Redis/MinIO process faults and persistent hashes;19 checks, plus readinessdeadline failure |
| `db-deploy.txt`, `migration-*.txt` | Fresh16 migrations and three existing-data compatibility probes |
| `ci-order-results.json`, `ci-clean-api-order.txt` | No-dist cold test failure; diagnostic exit0 does not mean CI works |
| `container-media.txt`, `container-broadcast.txt`, `compose-validation.txt` | Real production-built images in isolated test config, not a public production deployment |
| `dependency-audit-official.txt`, `dependency-production.txt` | Full40 affected dev-chain nodes; production0; no auto-fix performed |
| `media-performance.json`, `chat-*-observations.json`, `topics-*-observation.json`, `broadcast-*-measurements.json` | Controlled workloads, timing/resource measurements and their limits |
| `query-plan-results.json`, `worker-restart-process-samples.json` | Real PG warm index plan; bounded child-process samples, not complete native/FFmpeg profiling |
| `broadcast-*-cleanup.json`, `*.png` | Browser cleanup counts, synthetic Watch Room screenshots and initial retry failure |
| `hygiene-results.json`, `export-hygiene-results.json` | Known generated-secret/credential-pattern scan, bounded scope; no secret values |
| `cleanup-results.json` | Only audit-owned services stopped; ordinary Web/API health checked; volumes retained |
| `SHA256SUMS` | SHA-256 of exported files except itself; integrity inventory, not signed attestation |

## Replay and safety

Original tests remain at the reviewed commit. `verification-adaptations.patch` is a zero-context patch for an isolated copy of that commit; use `git apply --unidiff-zero` after inspecting it. New scripts under `probes/` are audit additions: copy `.spec.ts` to `e2e/`, `playwright.*.config.ts` to the copy root; place `.cjs` probes at root and `audit-*.mjs` helpers under `scripts/` as indicated in their imports. Some helpers reference this audit's absolute root; inspect and adapt those paths before replay.

The executed command wrapper was `node ../run.mjs <label> <command> <args...>`, loading private environment from the audit root and running in `verify/`. `commands.jsonl` records the exact child invocations. Wrapper/private credential files are intentionally not exported. Reproducers must provision their own credentials, ports, owned containers, database/bucket, Mailpit and callback configuration. See the report environment table for the nonsecret values used in this run.

Do not run container pause/restart/kill or migration probes against shared services. A database suffix ending `_test` alone does not establish ownership. Do not run API watch concurrently with child-process tests that require a stable compiled `dist`; do not let independently started workers claim the same fixture queue unexpectedly.

Tests requiring streaming used `BROADCAST_ENABLED=true`; real browser regression used the production-built Web. Container probes used production-built API/worker/Web images with `NODE_ENV=test`, isolated secrets and loopback ports. Default developer services and data were preserved.

Private raw logs/traces remain outside the Git evidence directory. Only selected sanitized artifacts are exported. Exported `.txt` logs normalize line endings and trailing whitespace only; original private logs retain raw output. Initial fixture/runner mistakes and timing failures are described in the report and command timeline. Diagnostic scripts intentionally record FAIL observations while returning successful collection status; read each result, not only exit codes. Repeated tests are not counted as new unique coverage.

This evidence does not establish production TLS/networking, external provider correctness, horizontal scaling, long-duration memory safety, Safari/iOS compatibility or disaster recovery. No production behavior fixes accompany these documents.
