# OpsPilot Portfolio Case Study

## One-Line Story

I translated a complex online-event operations domain into an original full-stack product that makes launch risk explainable, enforceable and auditable.

## The Problem

Teams launching customer-facing online events often spread critical decisions across event settings, access rules, runbooks, media tools and messages. A page can appear configured while ownership is missing, the audience policy is undefined, a production task is open or an asset has failed processing.

The product problem was not "build another admin dashboard." It was:

> How can an operations manager know whether an event is genuinely safe to launch, understand why, take the next action and prove what changed?

## Product Decision

I made **Launch Control** the product centre instead of recreating the breadth of a legacy livestream console. The workflow connects six evidence sources to a versioned readiness result and guards the event state transition.

That focus creates one strong demonstration:

1. Sign in with a real workspace role.
2. Create a scheduled event with an accountable owner.
3. Enter configuration through the domain state machine.
4. Clear access, content, media and critical-task gaps.
5. Watch readiness recalculate from evidence.
6. Reach 100 and transition the event to Ready.
7. Upload a bounded source video and inspect real processing evidence.
8. Transition a ready event and inspect signed webhook retries.
9. Connect the audit, outbox, worker and delivery records through one trace ID.

## My Contribution

This is a solo portfolio build covering product definition, interaction design, frontend, backend, data modelling, security, tests and documentation.

Key implementation decisions:

- Defined a clean-room product boundary before implementation.
- Used Next.js and Tailwind CSS for an original dense B2B interface.
- Used NestJS and Prisma to keep role and tenant enforcement server-side.
- Modelled operational evidence relationally rather than storing a generic event blob.
- Made readiness deterministic and versioned before adding optional AI.
- Added one bounded real-media path with private storage, ffprobe, FFmpeg and persisted worker attempts.
- Used a transactional outbox and signed webhooks to make failure recovery visible as product behaviour.
- Treated CI, threat modelling, accessibility and API contracts as release work.
- Added grounded optional AI with a deterministic fallback and explicit approval boundary.
- Persisted operational analytics and application error evidence rather than hardcoding portfolio claims.

## What Makes the Frontend Senior-Level

- The UI is organised around a repeated operational workflow, not a marketing landing page.
- Server state is cached and invalidated by domain identity.
- Search and status filters are represented in the URL.
- Every major page includes loading, empty or failure treatment.
- Controls reflect role capability while the API remains authoritative.
- Readiness exposes criterion evidence rather than only a decorative score.
- Media Library exposes direct-upload progress, worker progress, derivatives and private playback.
- Integration Centre turns asynchronous attempts, response codes and trace IDs into an operable workflow.
- Desktop and mobile layouts preserve hierarchy and avoid nested card-heavy composition.
- A Playwright journey verifies the complete workflow and axe checks key states.

## What Makes the Backend Credible

- Access and refresh cookies are HttpOnly and refresh sessions rotate through server-side hashes.
- Workspace scope is included in every domain lookup.
- Role policies produce 403 while cross-tenant lookups produce 404.
- A state machine rejects impossible lifecycle changes.
- Hard blockers are distinct from score gaps.
- Transactions pair mutations with audit writes and domain-event outbox records.
- BullMQ workers recover persisted media jobs and apply bounded retry policies.
- HMAC-signed webhook delivery uses duplicate suppression, replay controls and manual recovery.
- OpenAPI, dependency health, queue metrics, trace propagation and rate limits are part of the application.
- A real PostgreSQL integration test creates a second tenant to prove isolation.

## Product and Engineering Trade-Offs

### Deterministic rules before AI

Launch permission is a high-consequence decision. A versioned rules engine is explainable, testable and stable. A future LLM can draft or prioritise recommendations, but it should not be the sole launch gate.

### Bounded media pipeline before video-cloud breadth

Removing media would weaken the domain story. Pretending a file picker is a pipeline would weaken the engineering story. v1.1 therefore implements one complete path: direct private upload, actual stream validation, one browser-playable derivative profile, persisted retries and signed playback. Adaptive streaming, live ingest and DRM remain explicit v2 boundaries.

### Transactional outbox before more integrations

One reliable webhook tells a stronger engineering story than several optimistic connectors. Event state and its outbox record commit together; delivery is asynchronous, signed, bounded and idempotent. The UI exposes failure and recovery instead of hiding them in worker logs.

### Explicit OpenAPI contract

The initial metadata generator introduced a newly disclosed vulnerable parser dependency. I replaced it with an explicit OpenAPI 3.1 document and a smaller Swagger UI runtime, restoring a zero-vulnerability production audit while preserving inspectable API documentation.

### Grounded AI before autonomous actions

The provider receives a bounded readiness snapshot and can only return a strict advisory contract grounded in supplied criterion keys. Valid output is persisted for manager confirmation; invalid or unavailable output records a deterministic fallback. The model never controls launch state.

### Persisted snapshots before a data warehouse

Daily PostgreSQL snapshots make the Analytics screen and CSV export reproducible without adding warehouse infrastructure to a portfolio-sized system. The trade-off is UTC daily granularity rather than realtime attendee analytics.

## Quality Evidence

At v1.2 verification:

| Check                         | Result                                                     |
| ----------------------------- | ---------------------------------------------------------- |
| TypeScript                    | API and web pass                                           |
| ESLint                        | API, tests and web pass                                    |
| Domain unit tests             | 14 pass                                                    |
| API integration tests         | 13 pass                                                    |
| Playwright browser tests      | 6 pass                                                     |
| AI contract evaluation        | 5/5 pass                                                   |
| Real browser media path       | Direct upload, FFmpeg processing and private playback pass |
| Fail-once webhook path        | 503, automatic retry, 201 and one delivery record          |
| axe serious/critical findings | 0 on tested views                                          |
| Production dependency audit   | 0 known vulnerabilities                                    |
| Desktop visual review         | Media Library and Integration Centre pass at 1440 x 900    |
| Mobile visual review          | New workspaces have no root overflow at 390 x 844          |

## How This Connects to Prior Work

This project is a clean-room product interpretation of experience with enterprise online-event workflows. In an interview I can discuss the professional domain without claiming that confidential code or designs are mine:

- configuring live and on-demand experiences;
- audience access and registration concerns;
- media lifecycle and failure visibility;
- operational handovers and launch checklists;
- analytics and recommendations as support for human decisions;
- the difficulty of modernising a broad legacy console.

The portfolio shows what I personally designed and implemented. The work-history story explains the domain observations that helped me choose the problem.

## Interview Walkthrough

### Two-minute version

"OpsPilot is a full-stack launch-readiness product for online-event teams. I focused on one expensive operational question: can this event safely go live, and can we explain the answer? Launch Control combines ownership, schedule, audience access, content, media and critical tasks, while NestJS enforces a versioned evidence score and state machine. A private FFmpeg worker and transactional outbox make media and webhook failures recoverable. v1.2 adds persisted operational analytics and optional grounded AI that requires human confirmation while deterministic rules retain launch authority."

### Ten-minute path

1. Start on the unified sign-in page and use the two credential-fill shortcuts to explain manager versus analyst.
2. Show the dashboard risk distribution and priority recommendations.
3. Open Global Product Briefing and explain the 35-point evidence state.
4. Show that `Mark ready` is disabled by hard blockers.
5. Create a new event and explain the `DRAFT -> CONFIGURING` transition.
6. Configure access, complete tasks, add content and attach ready media.
7. Reach 100, move through Ready, Live, Completed and Archived, then inspect the audit record.
8. Upload the bounded sample video, open processing details and play the signed private derivative.
9. Move the seeded ready event to Live and show the fail-once delivery attempts in Integration Centre.
10. Open the architecture, threat model and runbook for server-side and operational proof.
11. Open Analytics to show persisted snapshots, CSV export, AI evaluation and error evidence.

## Retrospective

The v1.0 browser test exposed a mismatch between the UI action and API state machine, leading to the explicit `Start configuring` action. During v1.1 verification, the mobile integration tables leaked their intrinsic width into the root page; dedicated mobile delivery records fixed the workflow rather than merely hiding overflow. A final trace review also showed that request, outbox and delivery IDs were unrelated, so AsyncLocalStorage propagation and a durable media-job trace were added before release. In v1.2, the first mobile Analytics review exposed long evaluation IDs expanding a grid track; `min-width: 0` and deliberate identifier wrapping fixed the layout and became a permanent overflow test.

These are useful examples of the project's central lesson: quality work is not only implementing a planned feature. It is creating enough evidence for the system to contradict your assumptions early.
