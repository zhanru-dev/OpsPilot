export type WorkspaceRole =
  "ADMIN" | "OPERATIONS_MANAGER" | "CONTENT_OPERATOR" | "ANALYST" | "VIEWER";

export type User = {
  id: string;
  email: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
};

export type ReadinessCriterion = {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  passed: boolean;
  hardBlocker: boolean;
  evidence: string;
};

export type Readiness = {
  score: number;
  status: "READY" | "AT_RISK" | "BLOCKED";
  criteria: ReadinessCriterion[];
  blockers: string[];
  ruleVersion: string;
  assessedAt: string;
};

export type StreamEvent = {
  id: string;
  title: string;
  slug: string;
  description: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
  expectedAttendees: number;
  owner: {
    id: string;
    name: string;
    email?: string;
    avatarInitials: string;
  } | null;
  readiness: Readiness;
  _count?: {
    runbookItems: number;
    mediaAssets: number;
    recommendations: number;
  };
};

export type MediaAsset = {
  id: string;
  name: string;
  kind: "VIDEO" | "AUDIO";
  status:
    | "PENDING_UPLOAD"
    | "UPLOADING"
    | "PROCESSING"
    | "READY"
    | "FAILED"
    | "DELETED";
  description: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  previewUrl: string | null;
  failureReason: string | null;
  processingProgress: number;
  sourceContentType?: string | null;
  uploadedAt?: string | null;
  processedAt?: string | null;
  isSeeded: boolean;
  events?: Array<{ event: { id: string; title: string } }>;
  processingJobs?: MediaProcessingJob[];
  variants?: MediaVariant[];
  uploads?: MediaUpload[];
};

export type MediaProcessingAttempt = {
  id: string;
  attemptNumber: number;
  status: "PROCESSING" | "SUCCEEDED" | "FAILED";
  failureCode: string | null;
  failureReason: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type MediaProcessingJob = {
  id: string;
  status: "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
  profileVersion: string;
  attemptCount: number;
  maxAttempts: number;
  progress: number;
  failureCode: string | null;
  failureReason: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  attempts: MediaProcessingAttempt[];
};

export type MediaVariant = {
  id: string;
  kind: "PREVIEW" | "THUMBNAIL";
  contentType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
};

export type MediaUpload = {
  id: string;
  status: "PENDING" | "UPLOADED" | "EXPIRED" | "CANCELLED";
  contentType: string;
  expectedSizeBytes: number;
  expiresAt: string;
  completedAt: string | null;
};

export type WebhookEndpoint = {
  id: string;
  name: string;
  url: string;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  subscriptions: Array<{ id: string; eventType: string }>;
  _count?: { deliveries: number };
};

export type WebhookDeliveryAttempt = {
  id: string;
  attemptNumber: number;
  status: "PROCESSING" | "SUCCEEDED" | "FAILED";
  responseStatus: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
};

export type WebhookDelivery = {
  id: string;
  status: "PENDING" | "DELIVERING" | "RETRYING" | "SUCCEEDED" | "FAILED";
  attemptCount: number;
  responseStatus: number | null;
  nextRetryAt: string | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  traceId: string;
  createdAt: string;
  endpoint: { id: string; name: string; url: string };
  domainEvent: {
    id: string;
    type: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    occurredAt: string;
  };
  attempts: WebhookDeliveryAttempt[];
};

export type Recommendation = {
  id: string;
  key: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  title: string;
  summary: string;
  suggestedAction: string;
  evidence: Record<string, unknown>;
  createdAt: string;
};

export type FeatureFlagState = {
  id: string | null;
  key: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  effective: boolean;
  reason: string;
  updatedAt: string | null;
};

export type RecommendationProposal = {
  key: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  summary: string;
  evidenceKeys: string[];
  suggestedAction: string;
};

export type RecommendationRun = {
  id: string;
  provider: "DETERMINISTIC" | "OPENAI";
  status:
    "APPLIED" | "AWAITING_CONFIRMATION" | "FALLBACK" | "REJECTED" | "FAILED";
  model: string | null;
  promptVersion: string;
  output: {
    executiveSummary: string;
    recommendations: RecommendationProposal[];
  } | null;
  fallbackReason: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  confirmedAt: string | null;
  createdAt: string;
  requestedBy: { id: string; name: string };
  confirmedBy: { id: string; name: string } | null;
};

export type RecommendationResponse = {
  items: Recommendation[];
  authoritativeProvider: "DETERMINISTIC";
  ruleVersion: string;
  ai: FeatureFlagState | null;
  latestRun: RecommendationRun | null;
};

export type AnalyticsOverview = {
  days: number;
  generatedAt: string;
  latestSnapshotAt: string | null;
  kpis: {
    averageReadiness: number;
    launchConfidence: number;
    mediaReliability: number;
    deliveryReliability: number;
  };
  reliability: {
    openErrors: number;
    recommendationRuns: Record<string, number>;
  };
  series: Array<{
    date: string;
    averageReadiness: number;
    launchConfidence: number;
    mediaReliability: number;
    deliveryReliability: number;
    recommendationsResolved: number;
    errors: number;
  }>;
};

export type RecommendationEvaluationReport = {
  promptVersion: string;
  schemaVersion: string;
  passed: number;
  total: number;
  cases: Array<{
    id: string;
    description: string;
    expectedValid: boolean;
    actualValid: boolean;
    passed: boolean;
    errors: string[];
  }>;
  limitations: string[];
};

export type ErrorReport = {
  id: string;
  source: "WEB" | "API" | "WORKER";
  severity: "WARNING" | "ERROR" | "CRITICAL";
  status: "OPEN" | "RESOLVED";
  message: string;
  path: string | null;
  fingerprint: string;
  traceId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  user: { id: string; name: string } | null;
};

export type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
  actor: { id: string; name: string; avatarInitials: string } | null;
};
