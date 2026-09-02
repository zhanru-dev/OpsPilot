# ADR 0005: Keep AI Advisory and Deterministic Launch Authority Separate

- Status: Accepted
- Date: 2026-08-14

## Context

An LLM can summarise distributed operational evidence and draft useful actions, but probabilistic output is unsuitable as the authority for a safety-sensitive launch transition. The public demo must also remain useful without a provider key or network access.

## Decision

The versioned readiness engine remains the only authority for scores, blockers and event transitions. The optional OpenAI provider is enabled per workspace and only when a server-side API key is configured.

Provider input is a bounded snapshot of event and readiness evidence. Output uses a strict JSON schema and is validated again in application code. Every recommendation must cite supplied criterion keys. Unsupported fields, duplicate keys, unknown evidence, refusals, timeouts and provider errors are rejected.

Valid AI output is persisted as `AWAITING_CONFIRMATION`. An Operations Manager must explicitly confirm or reject it. If the provider is disabled, unconfigured or fails, deterministic recommendations are applied and the fallback reason is persisted.

## Consequences

- The no-key demo remains complete and deterministic.
- AI behaviour is inspectable through input/output snapshots, provider metadata, evaluation fixtures and audit events.
- Confirmation applies the advisory record; it never changes readiness rules implicitly.
- The five contract fixtures protect schema and grounding boundaries, not semantic model quality. A production rollout needs a larger labelled evaluation set and ongoing monitoring.
