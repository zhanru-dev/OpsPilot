# Development dependency mitigation (2026-11-04)

The final system audit identified advisories in development tooling. This remediation does not use `npm audit fix --force` or substitute incompatible major versions into legacy Jest/ESLint consumers. Production dependency audit and the complete development audit are recorded separately in the final remediation report.

## Effective controls

- Modern glob consumers use 14.0.3, beyond the 14.0.2 fix for [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4). Nest CLI is declared once at the workspace root so npm consistently applies the root overrides; API scripts continue to resolve the same CLI. The committed lockfile and the dependency security regression assert the actual Nest CLI resolution, not merely the requested override.
- Modern minimatch consumers use 11.0.4. Legacy minimatch 3 retains its callable API for ESLint/Jest tooling. The preprocessing method and optimization level implicated by [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) do not exist in that legacy implementation. This is a bounded applicability assessment, not a claim that all future legacy vulnerabilities are impossible.
- [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) has no upstream patched deepmerge release as of this review. `patches/deepmerge+4.3.1.patch` replaces assignment of copied keys with own data-property definitions in the source and both distributed builds. This prevents the `__proto__` setter from altering the result prototype, including when the target already contains a malicious own property or has a null prototype. Normal recursive object/array merging is retained. A downgrade outside the advisory version range would not be proof of a fix.

## Installation and verification

`npm ci` runs `scripts/apply-development-patches.cjs`; patch failure is fatal. Docker build stages copy the script and patch before installation. A production-only install without patch-package skips this development-only patch. Do not use `--ignore-scripts` for development/CI installations.

Run `npm run test:dependency-security` after a clean install. It exercises prototype poisoning and ordinary merge behavior, verifies the effective modern versions, and checks the legacy callable API. Run `npm run lint`, `npm run typecheck`, `npm test`, and production builds to detect tooling compatibility regressions.

The registry audit operates on package versions, not patched source or code reachability. It may continue to report deepmerge 4.3.1 and the broad minimatch range plus their transitive parent packages. Those warnings must remain visible and must not be presented as a clean full-tree audit. No advisory is hidden or deleted from audit output. Review the backport when upstream publishes a fix; replace it with a compatible upstream release and retain the regression tests. Repository/configuration inputs to development tools remain trusted local/CI inputs; this mitigation does not make arbitrary untrusted repositories safe to execute.

Executed full-tree audit: 39 affected dependency/parent entries (35 moderate, 4 low), rooted only in the two advisories above; production-only audit: zero. These counts are package graph entries, not 39 independent exploits. See the remediation evidence JSON for exact registry output.
