# ADR 0002: Keep Launch Authorization Deterministic

- Status: Accepted
- Date: 2026-08-13

## Context

OpsPilot should demonstrate AI literacy, but launch readiness is a consequential operational decision. A model-generated answer may vary, omit evidence or be difficult to regression test.

## Decision

Use a versioned deterministic rules engine as the authoritative launch gate.

- Calculate readiness from persisted event evidence.
- Return criterion-level scores and human-readable evidence.
- Mark owner, schedule, access and critical runbook failures as hard blockers.
- Persist assessment snapshots after evidence mutations.
- Allow recommendations to use deterministic rules in v1.0.
- Permit a grounded LLM recommendation provider in v1.2, with structured output, evaluation cases and human approval.
- Never allow an LLM recommendation alone to bypass hard blockers.

## Consequences

Positive:

- Results are explainable and repeatable.
- Unit tests can protect the decision contract.
- Rule-version evidence supports future migration and analytics.
- AI can improve prioritisation without becoming an opaque authorization layer.

Negative:

- Rules require deliberate maintenance as the domain grows.
- Nuanced risk signals may not fit binary evidence initially.
- A deterministic provider appears less novel than an early chatbot demo.

## Verification

The readiness unit suite covers complete evidence, hard blockers, non-blocking score gaps and workspace-safe missing resources. The browser golden flow proves that only a 100-point, blocker-free configuring event reaches Ready.
