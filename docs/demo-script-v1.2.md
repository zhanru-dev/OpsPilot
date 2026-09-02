# OpsPilot v1.2 Demo Script

Target length: 3 to 5 minutes.

## 0:00 - Product Problem

Open `/case-study`.

"OpsPilot helps online-event operations teams answer one expensive question: is this event safe to launch, and can we prove why? I built the product as an original clean-room system using Next.js, NestJS, Prisma, PostgreSQL, Redis and private object storage."

## 0:35 - Role Boundary

Open `/login`, choose Alex Morgan and sign in.

"There is one authentication flow. Roles are assigned to workspace memberships, so an Operations Manager can act while an Analyst sees the same evidence without mutation controls. The API remains the authority for every role check."

## 1:00 - Launch Control

Open Global Product Briefing.

"Launch Control combines ownership, schedule, access policy, content, ready media and critical tasks. The server returns criterion-level evidence, a versioned score and hard blockers. Invalid transitions are rejected even if a client tries to bypass the UI."

Show the deterministic fallback band and recommendations.

"Recommendations are useful, but they do not own the launch decision. With no OpenAI key, the demo records a deterministic fallback. With a configured provider, strict structured output must cite supplied evidence and then wait for explicit manager confirmation."

## 2:00 - Reliability

Open Media Library and then Integration Centre.

"The media path uploads directly to private S3-compatible storage, validates real streams with ffprobe and creates bounded FFmpeg derivatives in a BullMQ worker. Event transitions use a transactional outbox. The fail-once webhook preserves both the 503 and successful retry, with stable idempotency and trace evidence."

## 2:50 - Analytics and Error Evidence

Open Analytics.

"These charts come from daily PostgreSQL snapshots, not arrays in React. I can switch ranges, refresh today's snapshot and export the same rows as CSV. The AI assurance panel exposes provider state and the five committed contract evaluations. Browser and API errors are fingerprinted, traced and available for manager triage."

## 3:35 - Engineering Proof

Return to `/case-study` or show Swagger at `/docs`.

"The repository includes migrations, deterministic seed data, OpenAPI 3.1, ADRs, a threat model, recovery runbooks and CI. Unit, API and browser tests cover tenant isolation, permissions, launch rules, asynchronous recovery, accessibility and mobile overflow. The key trade-off is deliberate: one deep operational workflow with inspectable reliability evidence, rather than a broad dashboard that only looks complete."
