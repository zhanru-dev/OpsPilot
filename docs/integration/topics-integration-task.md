# Updated task: OpsPilot StreamOps Topics / Q&A integration

Approved by the user on 2026-10-29: update the reviewed prompt and execute it.
This document consolidates the original task and the agreed clarifications.

## Objective and baseline

Integrate the independently authored Mudu Topics capability into the existing OpsPilot
StreamOps product as the next complete vertical slice. OpsPilot is authoritative: Next App
Router, React/TypeScript, Nest, Prisma/PostgreSQL, StreamEvent, staff sessions, attendee
admission, design system, permissions and existing real-time infrastructure.

Start from actual HEAD `b09f5a2` on `feat/streamops-chat-integration`, including P1 Chat
reconnection fix `1ac03b4`. `cdd9242` is the historical Chat integration baseline only.
Mudu source baseline is `7bd9a2f36df8d0992260e1ba356754d6fce05f63`; keep that repository
unchanged, including its existing untracked streaming audit material.

Before implementation inspect both implementations, upgraded Topics documentation/tests,
Chat acceptance and remediation, OpsPilot Polls/Live Operations, Git state and unresolved
critical defects. Record the implementation plan, API/event contracts and schema design.
Then implement, test, debug, document and commit autonomously.

## Scope and architecture boundaries

Provide event-scoped text questions/topics, moderation, replies, editing, deletion, pins,
settings, pagination and real-time updates for staff and admitted attendees. Keep existing
Chat, Polls, operations, authentication, media and business workflows functional.

No duplicate Room, User, Workspace, login or competing WebSocket infrastructure. Minimal
extraction of shared principal authentication, current-authority validation and ticket
handling is allowed; preserve Chat contracts and recovery fixes. Topics owns its entities,
capabilities, revisions, subscriptions and UI state. Topics cleanup/failure cannot clear
Chat listeners or unnecessarily disconnect Chat. Document socket ownership explicitly.

This iteration is text-only: no attachments, uploads, media selection, new media pipeline,
polls replacement, nested forum, voting, resolved-question workflow or broadcast migration.
Do not copy historical production bundles, proprietary assets, branding or private research
into OpsPilot. Reimplement behaviour where provenance is unclear; reference source evidence
without copying historical captures. No destructive reset/seed of shared databases/storage.

## Identity, capabilities and lifecycle

Use the established staff/attendee principal abstraction. Attendees remain registrations
with validated event sessions, never WorkspaceMembership entries. Reject supplied sender,
role and workspace claims. Validate current sessions, memberships, eligibility, event scope
and effective permissions at protected REST and WebSocket operation/delivery boundaries.

| Principal | Read | Create/reply | Moderate/pin/delete | Configure |
|---|---|---|---|---|
| ADMIN / OPERATIONS_MANAGER | yes | yes | yes | yes |
| CONTENT_OPERATOR | yes | yes | no | no |
| ANALYST / VIEWER | yes | no | no | no |
| Admitted attendee | yes | subject to audience settings | no | no |

ADMIN/OPERATIONS_MANAGER submissions bypass review. Other authors require review when
moderation is enabled. Pending roots/replies are visible only to their author and current
moderators. Counts, direct lookups and notifications must obey visibility too.

Create/reply require READY/LIVE. Staff may read throughout the event lifecycle; moderators
may review/edit/remove after completion, but ARCHIVED is immutable. Configuration is allowed
before completion, including preparation. Attendee access follows existing admission and
event lifecycle rules. Revocation is rechecked for future operations and deliveries;
already-authorized operations may finish before revocation commits under documented locks.

## Data and business rules

Additive models scoped to StreamEvent: stable canonical IDs, distinct staff/attendee author
references, immutable request IDs/hashes, timestamps, versions, moderation state, pins,
soft deletion/moderator metadata and one-level reply relationships. Preserve old migrations.
Add indexes, same-event composite foreign keys and independent database constraints.

- Submit, list/filter/page, approve, reply, edit and delete.
- Only approved, live roots may be pinned, maximum seven per event. Protect the limit under
  concurrent moderators with transactions and database constraints; define pin order.
- Unpin before editing/deleting a root. Root deletion removes its entire visible reply
  projection. No reply may be added to a pending or deleted parent.
- Authors with current create access may edit their own unpinned roots. Moderators may edit
  any visible root. An ordinary edit requiring review moves an approved root to PENDING;
  previous public readers must remove both parent and replies until reapproval. Moderator
  edits retain current moderation status. Only moderators delete roots/replies.
- Reply management includes moderator deletion, but no reply editing or nested replies.
- Concurrent conflicting edits/moderation require expected entity versions and explicit
  409 responses. Identical desired-state retries are harmless and cannot revert newer state.
- Creation/reply retries use stable operation IDs; lost responses cannot duplicate records.
  Original request hashes remain valid after edits/deletion. Changed request payload conflicts.

## Settings

Audience publishing enabled, audience replies enabled, moderation required: all default true.
Settings restrict actual backend operations and are reflected in effective UI capabilities.
They never grant otherwise absent role capabilities. Disabling publishing also restricts
ordinary author edits. Disabling controls does not delete or hide existing approved content.
Disabling moderation does not retroactively approve pending content. Configure uses
expectedRevision; serialize settings/create/edit races and propagate changes to clients.

## State and real-time guarantees

Use one normalized canonical loaded window with derived approved/pending/pinned views,
visibility-scoped totals, explicit pagination and bounded rendering. Fence stale responses
by event, actor, filter, authority and request generation. Deleted or newly private roots
and children must not reappear through delayed acknowledgements, replies or snapshots.

Reuse current Socket.IO server/authentication. A Topics-specific consistency protocol is
allowed: content-free invalidations plus authorized snapshots and periodic recovery are
acceptable. Document lost-notification and commit-before-publish recovery. Do not interpret
filtered private events as missing Chat journal entries. Retain privacy during reconnect,
identity/event changes and unmount; module subscriptions and timers must be cleaned up.
Transient 503 failures must recover; actual session/access revocation must fail closed.

## Product integration

Staff Live Operations: questions overview, pending queue, approvals, replies, pins, edit and
delete controls, compact configuration. Attendee confirmation surface: questions, authorized
replies, submission/moderation feedback and real-time updates, preserving admission and Polls.
Use existing OpsPilot components and styling; no new shell/global state library/settings app.

## Required validation

Use isolated local PostgreSQL/Redis/storage and existing test infrastructure. Record exact
commands/results; do not claim unexecuted tests passed or replace integration with mocks.

Backend: persistence, role/setting enforcement, direct API isolation, invalid payloads,
idempotency/lost responses, reply FK/parent eligibility, seven-pin constraints, simultaneous
approval/pinning, edit/approve, reply/delete, configure/create and stale-version conflicts.
WebSocket: independent staff/attendees, private/public visibility, isolation, duplicate and
delayed updates, missed notifications, reconnect/503 recovery, expired tickets, revocation,
listener cleanup and Chat coexistence. Document lock order and observe Chat under contention.
Browser: actual staff login and attendee admission, pending submission, moderator approval,
another participant's reply, pin, two moderators' conflicting actions, reload/reconnect,
editing back to pending with privacy cleanup, settings, denied cross-event access.

Run existing Chat suites including all 12 recovery E2Es; authentication/admission, Polls,
Live Operations, workspace/event permissions and media workflow regressions. Run unit/state
checks, real API/DB/WS integration, browser E2E, type checks, lint and production builds.

## Delivery and stop boundary

Create docs/integration/topics-migration-report.md with source/destination mapping, reuse,
changes, model, auth, state/transport, invariants, concurrency, actual test evidence, security,
limitations, trade-offs and Git checkpoint. Update integration documentation as needed.
Use small reviewable commits. Escalate only missing credentials, destructive actions,
unresolved provenance or significant scope changes. Completion requires all critical tests
and builds passing with no unresolved in-scope P0/P1. Report features, schema/architecture,
commands/results, Chat/Polls regressions, security/concurrency, limitations and commit/branch.
STOP after Topics. Do not start Media Library or Live Streaming migration.
