# ADR 0006: Persist Daily Operational Analytics Snapshots

- Status: Accepted
- Date: 2026-08-14

## Context

Calculating every historical chart from mutable operational tables would be expensive and could rewrite the apparent past when an event changes. Hardcoded frontend chart data would make the portfolio claim impossible to inspect.

## Decision

Store one workspace-scoped `DAILY` snapshot per UTC day. A snapshot records event readiness distribution, average score, media outcomes, webhook outcomes, recommendation activity and browser/API error counts. The API derives KPI percentages and date-range series from those rows.

Managers can refresh today's row through an audited API command. All authenticated workspace roles can inspect the same persisted range and export it as CSV.

## Consequences

- Charts and CSV exports are reproducible from PostgreSQL.
- Historical rows remain stable while today's row can be recalculated.
- UTC day boundaries keep the initial model simple and explicit.
- Production scale may require scheduled capture, retention rules, timezone-aware reporting and a warehouse; those are intentionally outside v1.2.
