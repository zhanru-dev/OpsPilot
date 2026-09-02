import {
  AccessMode,
  AnalyticsGranularity,
  ContentBlockType,
  ErrorReportSeverity,
  ErrorReportSource,
  ErrorReportStatus,
  EventStatus,
  LiveSessionStatus,
  LiveSessionUpdateSeverity,
  MediaKind,
  MediaStatus,
  OutboxStatus,
  PrismaClient,
  RecommendationRunProvider,
  RecommendationRunStatus,
  RecommendationSeverity,
  RunbookStatus,
  WorkspaceRole,
  WebhookAttemptStatus,
  WebhookDeliveryStatus,
} from "@prisma/client";
import * as argon2 from "argon2";
import { createCipheriv, createHash, randomBytes } from "node:crypto";

if (
  process.env.NODE_ENV === "production" &&
  process.env.DEMO_SEED_ALLOWED !== "true"
) {
  throw new Error(
    "Refusing to seed a production database without DEMO_SEED_ALLOWED=true.",
  );
}

const prisma = new PrismaClient();

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111",
  opsUser: "22222222-2222-4222-8222-222222222221",
  analystUser: "22222222-2222-4222-8222-222222222222",
  adminUser: "22222222-2222-4222-8222-222222222223",
  globalBriefing: "33333333-3333-4333-8333-333333333331",
  partnerLive: "33333333-3333-4333-8333-333333333332",
  townHall: "33333333-3333-4333-8333-333333333333",
  securityWorkshop: "33333333-3333-4333-8333-333333333334",
  videoReady: "44444444-4444-4444-8444-444444444441",
  audioReady: "44444444-4444-4444-8444-444444444442",
  videoFailed: "44444444-4444-4444-8444-444444444443",
  webhookEndpoint: "55555555-5555-4555-8555-555555555551",
  domainEvent: "66666666-6666-4666-8666-666666666661",
  webhookDelivery: "77777777-7777-4777-8777-777777777771",
  featureFlag: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  recommendationRun: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  errorReport: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  liveSession: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
};

function encryptWebhookSecret(value: string) {
  const key = createHash("sha256")
    .update(
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY ??
        "opspilot-local-webhook-encryption-key-change-me",
    )
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return ["v1", iv, cipher.getAuthTag(), encrypted]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(".");
}

async function main() {
  await prisma.errorReport.deleteMany();
  await prisma.analyticsSnapshot.deleteMany();
  await prisma.featureFlag.deleteMany();
  await prisma.recommendationRun.deleteMany();
  await prisma.webhookDeliveryAttempt.deleteMany();
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await prisma.domainEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.recommendation.deleteMany();
  await prisma.readinessAssessment.deleteMany();
  await prisma.eventMediaAsset.deleteMany();
  await prisma.mediaVariant.deleteMany();
  await prisma.mediaProcessingAttempt.deleteMany();
  await prisma.mediaProcessingJob.deleteMany();
  await prisma.mediaUpload.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.contentBlock.deleteMany();
  await prisma.accessPolicy.deleteMany();
  await prisma.runbookItem.deleteMany();
  await prisma.streamEvent.deleteMany();
  await prisma.session.deleteMany();
  await prisma.workspaceMembership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();

  const passwordHash = await argon2.hash("DemoPass123!");
  const workspace = await prisma.workspace.create({
    data: {
      id: ids.workspace,
      name: "Brightline Events",
      slug: "brightline-events",
      timezone: "Europe/London",
    },
  });

  const [operationsManager, analyst, admin] = await Promise.all([
    prisma.user.create({
      data: {
        id: ids.opsUser,
        email: "alex.morgan@opspilot.demo",
        passwordHash,
        name: "Alex Morgan",
        jobTitle: "Operations Manager",
        avatarInitials: "AM",
      },
    }),
    prisma.user.create({
      data: {
        id: ids.analystUser,
        email: "maya.chen@opspilot.demo",
        passwordHash,
        name: "Maya Chen",
        jobTitle: "Audience Analyst",
        avatarInitials: "MC",
      },
    }),
    prisma.user.create({
      data: {
        id: ids.adminUser,
        email: "jordan.lee@opspilot.demo",
        passwordHash,
        name: "Jordan Lee",
        jobTitle: "Workspace Admin",
        avatarInitials: "JL",
      },
    }),
  ]);

  await prisma.workspaceMembership.createMany({
    data: [
      {
        workspaceId: workspace.id,
        userId: operationsManager.id,
        role: WorkspaceRole.OPERATIONS_MANAGER,
      },
      {
        workspaceId: workspace.id,
        userId: analyst.id,
        role: WorkspaceRole.ANALYST,
      },
      {
        workspaceId: workspace.id,
        userId: admin.id,
        role: WorkspaceRole.ADMIN,
      },
    ],
  });

  const now = Date.now();
  await prisma.streamEvent.createMany({
    data: [
      {
        id: ids.globalBriefing,
        workspaceId: workspace.id,
        ownerId: operationsManager.id,
        title: "Global Product Briefing",
        slug: "global-product-briefing",
        description:
          "A customer-facing launch briefing for the Autumn product release.",
        status: EventStatus.CONFIGURING,
        scheduledStart: new Date(now + 30 * 60 * 60 * 1000),
        scheduledEnd: new Date(now + 31 * 60 * 60 * 1000),
        timezone: "Europe/London",
        expectedAttendees: 850,
      },
      {
        id: ids.partnerLive,
        workspaceId: workspace.id,
        ownerId: operationsManager.id,
        title: "Partner Enablement Live",
        slug: "partner-enablement-live",
        description:
          "A private enablement session for certified implementation partners.",
        status: EventStatus.LIVE,
        scheduledStart: new Date(now + 6 * 24 * 60 * 60 * 1000),
        scheduledEnd: new Date(now + 6 * 24 * 60 * 60 * 1000 + 90 * 60 * 1000),
        timezone: "Europe/London",
        expectedAttendees: 320,
      },
      {
        id: ids.townHall,
        workspaceId: workspace.id,
        ownerId: admin.id,
        title: "Quarterly Company Town Hall",
        slug: "quarterly-company-town-hall",
        description:
          "Company performance, product updates and an employee Q&A.",
        status: EventStatus.COMPLETED,
        scheduledStart: new Date(now - 14 * 24 * 60 * 60 * 1000),
        scheduledEnd: new Date(now - 14 * 24 * 60 * 60 * 1000 + 75 * 60 * 1000),
        timezone: "Europe/London",
        expectedAttendees: 1200,
      },
      {
        id: ids.securityWorkshop,
        workspaceId: workspace.id,
        ownerId: null,
        title: "Security Readiness Workshop",
        slug: "security-readiness-workshop",
        description:
          "An internal workshop for incident coordinators and engineering leads.",
        status: EventStatus.DRAFT,
        scheduledStart: new Date(now + 12 * 24 * 60 * 60 * 1000),
        scheduledEnd: new Date(
          now + 12 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000,
        ),
        timezone: "Europe/London",
        expectedAttendees: 90,
      },
    ],
  });

  await prisma.runbookItem.createMany({
    data: [
      {
        eventId: ids.globalBriefing,
        ownerId: operationsManager.id,
        title: "Confirm production speaker handover",
        description: "Complete the final speaker-to-producer cue walkthrough.",
        status: RunbookStatus.TODO,
        isCritical: true,
        dueAt: new Date(now + 12 * 60 * 60 * 1000),
        sortOrder: 1,
      },
      {
        eventId: ids.globalBriefing,
        ownerId: operationsManager.id,
        title: "Review opening slides",
        status: RunbookStatus.DONE,
        isCritical: false,
        sortOrder: 2,
      },
      {
        eventId: ids.globalBriefing,
        ownerId: operationsManager.id,
        title: "Confirm support escalation channel",
        status: RunbookStatus.DONE,
        isCritical: true,
        sortOrder: 3,
      },
      {
        eventId: ids.partnerLive,
        ownerId: operationsManager.id,
        title: "Complete partner access check",
        status: RunbookStatus.DONE,
        isCritical: true,
        sortOrder: 1,
      },
      {
        eventId: ids.partnerLive,
        ownerId: operationsManager.id,
        title: "Approve presenter deck",
        status: RunbookStatus.DONE,
        isCritical: true,
        sortOrder: 2,
      },
      {
        eventId: ids.securityWorkshop,
        title: "Assign an event owner",
        status: RunbookStatus.TODO,
        isCritical: true,
        sortOrder: 1,
      },
    ],
  });

  await prisma.accessPolicy.createMany({
    data: [
      {
        eventId: ids.partnerLive,
        mode: AccessMode.EMAIL_DOMAIN,
        allowedDomains: ["partner.example"],
        requiresConsent: true,
        collectCompany: true,
        collectJobTitle: true,
      },
      {
        eventId: ids.townHall,
        mode: AccessMode.EMAIL_DOMAIN,
        allowedDomains: ["brightline.example"],
        requiresConsent: true,
        collectCompany: false,
        collectJobTitle: false,
      },
    ],
  });

  await prisma.contentBlock.createMany({
    data: [
      {
        eventId: ids.globalBriefing,
        type: ContentBlockType.HERO,
        title: "Build with confidence",
        body: "A concise briefing on the new release, rollout plan and customer outcomes.",
        sortOrder: 1,
      },
      {
        eventId: ids.globalBriefing,
        type: ContentBlockType.AGENDA,
        title: "Briefing agenda",
        body: "Product vision, live demonstration, rollout plan and questions.",
        sortOrder: 2,
      },
      {
        eventId: ids.partnerLive,
        type: ContentBlockType.HERO,
        title: "Deliver better implementations",
        body: "Technical enablement for the next partner release.",
        sortOrder: 1,
      },
      {
        eventId: ids.townHall,
        type: ContentBlockType.AGENDA,
        title: "Company update",
        body: "Quarterly results, customer stories, roadmap and Q&A.",
        sortOrder: 1,
      },
    ],
  });

  await prisma.mediaAsset.createMany({
    data: [
      {
        id: ids.videoReady,
        workspaceId: workspace.id,
        name: "Autumn release opener.mp4",
        kind: MediaKind.VIDEO,
        status: MediaStatus.READY,
        description:
          "Approved 30-second opening video for customer-facing events.",
        durationSeconds: 30,
        sizeBytes: 18432000,
        width: 1280,
        height: 720,
        previewUrl:
          "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
        isSeeded: true,
      },
      {
        id: ids.audioReady,
        workspaceId: workspace.id,
        name: "Accessibility audio check.mp3",
        kind: MediaKind.AUDIO,
        status: MediaStatus.READY,
        description: "Short CC0 audio asset used to verify browser playback.",
        durationSeconds: 5,
        sizeBytes: 42500,
        previewUrl:
          "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3",
        isSeeded: true,
      },
      {
        id: ids.videoFailed,
        workspaceId: workspace.id,
        name: "Partner case study.mov",
        kind: MediaKind.VIDEO,
        status: MediaStatus.FAILED,
        description:
          "A deterministic demo failure for the v1.0 media workflow.",
        durationSeconds: 92,
        sizeBytes: 98500000,
        failureReason:
          "Unsupported source codec in the v1.0 demo processing profile.",
        isSeeded: true,
      },
    ],
  });

  await prisma.eventMediaAsset.create({
    data: {
      eventId: ids.partnerLive,
      mediaId: ids.videoReady,
      purpose: "event-opener",
    },
  });

  await prisma.recommendation.createMany({
    data: [
      {
        eventId: ids.globalBriefing,
        key: "missing-access-policy",
        severity: RecommendationSeverity.HIGH,
        title: "Define who can access this event",
        summary:
          "No audience access policy is configured for a customer-facing briefing.",
        evidence: { accessPolicy: null, expectedAttendees: 850 },
        suggestedAction:
          "Choose registration or email-domain access before marking the event ready.",
      },
      {
        eventId: ids.globalBriefing,
        key: "critical-runbook-incomplete",
        severity: RecommendationSeverity.HIGH,
        title: "Complete the speaker handover",
        summary:
          "One critical production task remains incomplete within 24 hours of launch.",
        evidence: { openCriticalItems: 1, hoursUntilStart: 30 },
        suggestedAction:
          "Assign and complete the final production speaker handover.",
      },
      {
        eventId: ids.securityWorkshop,
        key: "missing-owner",
        severity: RecommendationSeverity.HIGH,
        title: "Assign operational ownership",
        summary: "This workshop has no accountable event owner.",
        evidence: { ownerId: null },
        suggestedAction:
          "Assign an Operations Manager before configuration continues.",
      },
    ],
  });

  await prisma.featureFlag.create({
    data: {
      id: ids.featureFlag,
      workspaceId: workspace.id,
      updatedById: operationsManager.id,
      key: "AI_RECOMMENDATIONS",
      description:
        "Allow grounded OpenAI recommendations when a server-side API key is configured.",
      enabled: true,
    },
  });

  await prisma.recommendationRun.create({
    data: {
      id: ids.recommendationRun,
      workspaceId: workspace.id,
      eventId: ids.globalBriefing,
      requestedById: operationsManager.id,
      confirmedById: operationsManager.id,
      provider: RecommendationRunProvider.DETERMINISTIC,
      status: RecommendationRunStatus.FALLBACK,
      promptVersion: "1.2",
      inputSnapshot: {
        event: {
          id: ids.globalBriefing,
          title: "Global Customer Briefing",
          status: "CONFIGURING",
          expectedAttendees: 850,
        },
        readiness: {
          score: 35,
          status: "BLOCKED",
          ruleVersion: "1.0",
          blockers: [
            "No audience access policy is configured.",
            "One critical production task remains incomplete.",
          ],
          criteria: [
            { key: "access-policy", passed: false, hardBlocker: true },
            { key: "runbook", passed: false, hardBlocker: true },
          ],
        },
      },
      output: {
        executiveSummary:
          "The deterministic provider handled this request because the optional API key is not configured.",
        recommendations: [
          {
            key: "readiness-access-policy",
            severity: "HIGH",
            title: "Define audience access",
            summary: "Audience access is a hard launch blocker.",
            evidenceKeys: ["access-policy"],
            suggestedAction:
              "Choose and save an audience access policy before launch review.",
          },
        ],
      },
      fallbackReason:
        "The optional AI provider is enabled but no server-side API key is configured.",
      confirmedAt: new Date(now - 30 * 60_000),
      createdAt: new Date(now - 30 * 60_000),
    },
  });

  const analyticsStart = new Date();
  analyticsStart.setUTCHours(0, 0, 0, 0);
  await prisma.analyticsSnapshot.createMany({
    data: Array.from({ length: 14 }, (_, index) => {
      const periodStart = new Date(
        analyticsStart.getTime() - (13 - index) * 86_400_000,
      );
      return {
        workspaceId: workspace.id,
        granularity: AnalyticsGranularity.DAILY,
        periodStart,
        periodEnd: new Date(periodStart.getTime() + 86_400_000),
        eventsTotal: 4,
        readyEvents: index < 4 ? 1 : index < 10 ? 2 : 3,
        atRiskEvents: index < 8 ? 1 : 0,
        blockedEvents: index < 4 ? 2 : index < 10 ? 1 : 1,
        averageReadiness: 58 + index * 2,
        mediaProcessed: 3 + (index % 4),
        mediaFailed: index % 5 === 0 ? 1 : 0,
        webhookSucceeded: 8 + index,
        webhookFailed: index === 3 || index === 9 ? 1 : 0,
        recommendationsOpened: Math.max(1, 5 - Math.floor(index / 4)),
        recommendationsResolved: 1 + Math.floor(index / 3),
        webErrors: index === 5 ? 1 : 0,
        apiErrors: index === 2 ? 1 : 0,
      };
    }),
  });

  await prisma.errorReport.create({
    data: {
      id: ids.errorReport,
      workspaceId: workspace.id,
      userId: operationsManager.id,
      source: ErrorReportSource.WEB,
      severity: ErrorReportSeverity.WARNING,
      status: ErrorReportStatus.RESOLVED,
      message: "Seeded browser recovery evidence: one chunk request retried.",
      path: "/streamops/media",
      fingerprint:
        "9f1545d899ce3ec424fb881992a041b6f98403449648d4d8873f8e774e480eb5",
      traceId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
      metadata: { seeded: true, recovered: true },
      resolvedAt: new Date(now - 45 * 60_000),
      createdAt: new Date(now - 60 * 60_000),
    },
  });

  await prisma.readinessAssessment.createMany({
    data: [
      {
        eventId: ids.globalBriefing,
        score: 35,
        criteria: {
          owner: { score: 10, max: 10, passed: true },
          schedule: { score: 10, max: 10, passed: true },
          accessPolicy: { score: 0, max: 25, passed: false },
          content: { score: 15, max: 15, passed: true },
          media: { score: 0, max: 15, passed: false },
          runbook: { score: 0, max: 25, passed: false },
        },
        blockers: [
          "Access policy is missing",
          "A critical runbook item is incomplete",
        ],
      },
      {
        eventId: ids.partnerLive,
        score: 100,
        criteria: { complete: true },
        blockers: [],
      },
      {
        eventId: ids.townHall,
        score: 85,
        criteria: { completedEvent: true },
        blockers: [],
      },
      {
        eventId: ids.securityWorkshop,
        score: 10,
        criteria: { owner: { score: 0, max: 10, passed: false } },
        blockers: ["Event owner is missing", "Access policy is missing"],
      },
    ],
  });

  await prisma.liveSession.create({
    data: {
      id: ids.liveSession,
      workspaceId: workspace.id,
      eventId: ids.partnerLive,
      startedById: operationsManager.id,
      status: LiveSessionStatus.ACTIVE,
      startedAt: new Date(now - 18 * 60 * 1000),
      updates: {
        create: [
          {
            actorId: operationsManager.id,
            severity: LiveSessionUpdateSeverity.INFO,
            message: "Partner Enablement Live went live.",
            createdAt: new Date(now - 18 * 60 * 1000),
          },
          {
            actorId: operationsManager.id,
            severity: LiveSessionUpdateSeverity.WARNING,
            message:
              "Backup speaker joined after a brief connection delay; primary programme remains on schedule.",
            createdAt: new Date(now - 7 * 60 * 1000),
          },
          {
            actorId: operationsManager.id,
            severity: LiveSessionUpdateSeverity.INFO,
            message: "Audience audio route checked and stable.",
            createdAt: new Date(now - 3 * 60 * 1000),
          },
        ],
      },
    },
  });

  await prisma.auditLog.createMany({
    data: [
      {
        workspaceId: workspace.id,
        eventId: ids.globalBriefing,
        actorId: operationsManager.id,
        action: "event.updated",
        entityType: "StreamEvent",
        entityId: ids.globalBriefing,
        summary: "Updated the event schedule and expected audience.",
      },
      {
        workspaceId: workspace.id,
        eventId: ids.globalBriefing,
        actorId: operationsManager.id,
        action: "content.created",
        entityType: "ContentBlock",
        entityId: "seeded-hero",
        summary: "Added launch-page hero content.",
      },
      {
        workspaceId: workspace.id,
        eventId: ids.partnerLive,
        actorId: operationsManager.id,
        action: "event.ready",
        entityType: "StreamEvent",
        entityId: ids.partnerLive,
        summary: "Marked Partner Enablement Live as ready.",
      },
      {
        workspaceId: workspace.id,
        eventId: ids.partnerLive,
        actorId: operationsManager.id,
        action: "event.live",
        entityType: "StreamEvent",
        entityId: ids.partnerLive,
        summary: "Moved Partner Enablement Live from READY to LIVE.",
      },
    ],
  });

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      id: ids.webhookEndpoint,
      workspaceId: workspace.id,
      name: "Launch reliability demo",
      url: `${process.env.WEBHOOK_RECEIVER_BASE_URL ?? "http://localhost:4100/api/v1/demo/webhook-receiver"}?mode=fail-once`,
      secretEncrypted: encryptWebhookSecret("opspilot-seeded-webhook-secret"),
      subscriptions: {
        create: [
          { eventType: "event.ready" },
          { eventType: "event.started" },
          { eventType: "event.completed" },
          { eventType: "live-session.update.recorded" },
        ],
      },
    },
  });
  const domainEvent = await prisma.domainEvent.create({
    data: {
      id: ids.domainEvent,
      workspaceId: workspace.id,
      type: "event.ready",
      aggregateType: "StreamEvent",
      aggregateId: ids.partnerLive,
      traceId: "88888888-8888-4888-8888-888888888881",
      payload: {
        eventId: ids.partnerLive,
        title: "Partner Enablement Live",
        previousStatus: "CONFIGURING",
        status: "READY",
        actorId: operationsManager.id,
      },
      outbox: {
        create: {
          status: OutboxStatus.PUBLISHED,
          publishedAt: new Date(now - 20_000),
          attemptCount: 1,
        },
      },
    },
  });
  await prisma.webhookDelivery.create({
    data: {
      id: ids.webhookDelivery,
      workspaceId: workspace.id,
      endpointId: endpoint.id,
      domainEventId: domainEvent.id,
      status: WebhookDeliveryStatus.SUCCEEDED,
      attemptCount: 2,
      responseStatus: 201,
      lastAttemptAt: new Date(now - 12_000),
      deliveredAt: new Date(now - 12_000),
      traceId: "99999999-9999-4999-8999-999999999991",
      attempts: {
        create: [
          {
            attemptNumber: 1,
            status: WebhookAttemptStatus.FAILED,
            responseStatus: 503,
            durationMs: 24,
            error: "HTTP 503: deterministic transient demo failure.",
            createdAt: new Date(now - 15_000),
          },
          {
            attemptNumber: 2,
            status: WebhookAttemptStatus.SUCCEEDED,
            responseStatus: 201,
            durationMs: 6,
            createdAt: new Date(now - 12_000),
          },
        ],
      },
    },
  });

  console.info("Seeded OpsPilot v1.5 demo data.");
  console.info("Operations Manager: alex.morgan@opspilot.demo / DemoPass123!");
  console.info("Analyst: maya.chen@opspilot.demo / DemoPass123!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
