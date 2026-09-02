const uuidParameter = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string', format: 'uuid' },
});

const jsonBody = (schema: Record<string, unknown>) => ({
  required: true,
  content: { 'application/json': { schema } },
});

const jsonResponse = (
  schema: Record<string, unknown>,
  description: string,
) => ({
  description,
  content: { 'application/json': { schema } },
});

const responses = {
  ok: { description: 'Request completed successfully.' },
  created: { description: 'Resource created successfully.' },
  noContent: { description: 'Request completed with no response body.' },
  unauthorized: { description: 'A valid access session is required.' },
  forbidden: { description: 'The workspace role cannot perform this action.' },
  notFound: { description: 'The workspace-scoped resource was not found.' },
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'OpsPilot API',
    version: '1.2.0',
    description:
      'Workspace-scoped API for launch readiness, private media processing, reliable integrations, grounded AI advisory and persisted operational analytics.',
  },
  servers: [{ url: '/api/v1', description: 'Current server' }],
  tags: [
    { name: 'Auth' },
    { name: 'Health' },
    { name: 'Dashboard' },
    { name: 'Stream events' },
    { name: 'Launch control' },
    { name: 'Media' },
    { name: 'Integrations' },
    { name: 'Analytics' },
    { name: 'AI assurance' },
    { name: 'Error evidence' },
    { name: 'Governance' },
  ],
  security: [{ accessCookie: [] }],
  paths: {
    '/health/live': {
      get: {
        tags: ['Health'],
        summary: 'Check process liveness',
        security: [],
        responses: { 200: responses.ok },
      },
    },
    '/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Check database, object storage and queue readiness',
        security: [],
        responses: {
          200: responses.ok,
          503: {
            description: 'One or more required dependencies are unavailable.',
          },
        },
      },
    },
    '/health/metrics': {
      get: {
        tags: ['Health'],
        summary: 'Get queue depth and persisted reliability counters',
        responses: { 200: responses.ok, 401: responses.unauthorized },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in with email and password',
        security: [],
        requestBody: jsonBody({ $ref: '#/components/schemas/LoginRequest' }),
        responses: {
          200: jsonResponse(
            { $ref: '#/components/schemas/AuthResponse' },
            'Authenticated user and active workspace role.',
          ),
          401: responses.unauthorized,
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate the refresh session',
        security: [{ refreshCookie: [] }],
        responses: {
          200: jsonResponse(
            { $ref: '#/components/schemas/AuthResponse' },
            'Rotated session and authenticated user.',
          ),
          401: responses.unauthorized,
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke the current session',
        responses: { 204: responses.noContent, 401: responses.unauthorized },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get the current user and workspace role',
        responses: {
          200: jsonResponse(
            { $ref: '#/components/schemas/AuthResponse' },
            'Authenticated user and active workspace role.',
          ),
          401: responses.unauthorized,
        },
      },
    },
    '/dashboard/summary': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get workspace KPIs, event risk and recent activity',
        responses: { 200: responses.ok, 401: responses.unauthorized },
      },
    },
    '/stream-events': {
      get: {
        tags: ['Stream events'],
        summary: 'List workspace events',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          {
            name: 'status',
            in: 'query',
            schema: { $ref: '#/components/schemas/EventStatus' },
          },
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', minimum: 1 },
          },
          {
            name: 'pageSize',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 50 },
          },
        ],
        responses: { 200: responses.ok, 401: responses.unauthorized },
      },
      post: {
        tags: ['Stream events'],
        summary: 'Create an event and its default runbook',
        requestBody: jsonBody({
          $ref: '#/components/schemas/CreateEventRequest',
        }),
        responses: {
          201: responses.created,
          403: responses.forbidden,
          422: { description: 'Request validation failed.' },
        },
      },
    },
    '/stream-events/{eventId}': {
      get: {
        tags: ['Stream events'],
        summary: 'Get Launch Control detail',
        parameters: [uuidParameter('eventId', 'Stream event ID')],
        responses: {
          200: jsonResponse(
            { $ref: '#/components/schemas/Readiness' },
            'Current deterministic readiness evidence.',
          ),
          404: responses.notFound,
        },
      },
      patch: {
        tags: ['Stream events'],
        summary: 'Update event configuration',
        parameters: [uuidParameter('eventId', 'Stream event ID')],
        requestBody: jsonBody({
          $ref: '#/components/schemas/UpdateEventRequest',
        }),
        responses: {
          200: responses.ok,
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/stream-events/{eventId}/readiness': {
      get: {
        tags: ['Launch control'],
        summary: 'Calculate readiness from current evidence',
        parameters: [uuidParameter('eventId', 'Stream event ID')],
        responses: { 200: responses.ok, 404: responses.notFound },
      },
    },
    '/stream-events/{eventId}/transitions': {
      post: {
        tags: ['Launch control'],
        summary: 'Move an event through the guarded state machine',
        parameters: [uuidParameter('eventId', 'Stream event ID')],
        requestBody: jsonBody({
          type: 'object',
          required: ['status'],
          properties: { status: { $ref: '#/components/schemas/EventStatus' } },
        }),
        responses: {
          201: responses.ok,
          400: {
            description: 'The transition is invalid or readiness is blocked.',
          },
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/runbook-items/{itemId}': {
      patch: {
        tags: ['Launch control'],
        summary: 'Update a runbook task status',
        parameters: [uuidParameter('itemId', 'Runbook item ID')],
        requestBody: jsonBody({
          type: 'object',
          required: ['status'],
          properties: { status: { enum: ['TODO', 'IN_PROGRESS', 'DONE'] } },
        }),
        responses: {
          200: responses.ok,
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/stream-events/{eventId}/access-policy': {
      get: {
        tags: ['Launch control'],
        summary: 'Get audience access policy and preview',
        parameters: [uuidParameter('eventId', 'Stream event ID')],
        responses: { 200: responses.ok, 404: responses.notFound },
      },
      put: {
        tags: ['Launch control'],
        summary: 'Create or replace the audience access policy',
        parameters: [uuidParameter('eventId', 'Stream event ID')],
        requestBody: jsonBody({
          $ref: '#/components/schemas/AccessPolicyRequest',
        }),
        responses: {
          200: responses.ok,
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/stream-events/{eventId}/content-blocks': {
      post: {
        tags: ['Launch control'],
        summary: 'Add watch-page content',
        parameters: [uuidParameter('eventId', 'Stream event ID')],
        requestBody: jsonBody({
          $ref: '#/components/schemas/ContentBlockRequest',
        }),
        responses: {
          201: responses.created,
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/content-blocks/{blockId}': {
      patch: {
        tags: ['Launch control'],
        summary: 'Update watch-page content',
        parameters: [uuidParameter('blockId', 'Content block ID')],
        requestBody: jsonBody({
          $ref: '#/components/schemas/ContentBlockRequest',
        }),
        responses: {
          200: responses.ok,
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
      delete: {
        tags: ['Launch control'],
        summary: 'Remove watch-page content',
        parameters: [uuidParameter('blockId', 'Content block ID')],
        responses: {
          200: responses.ok,
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/media-assets': {
      get: {
        tags: ['Media'],
        summary: 'List workspace media assets',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'kind', in: 'query', schema: { enum: ['VIDEO', 'AUDIO'] } },
          {
            name: 'status',
            in: 'query',
            schema: {
              enum: [
                'PENDING_UPLOAD',
                'UPLOADING',
                'PROCESSING',
                'READY',
                'FAILED',
                'DELETED',
              ],
            },
          },
        ],
        responses: { 200: responses.ok },
      },
    },
    '/media-assets/{mediaId}': {
      get: {
        tags: ['Media'],
        summary: 'Get a workspace media asset',
        parameters: [uuidParameter('mediaId', 'Media asset ID')],
        responses: { 200: responses.ok, 404: responses.notFound },
      },
    },
    '/media-assets/uploads': {
      post: {
        tags: ['Media'],
        summary: 'Create a short-lived direct upload intent',
        requestBody: jsonBody({
          $ref: '#/components/schemas/CreateMediaUploadRequest',
        }),
        responses: {
          201: responses.created,
          403: responses.forbidden,
          422: { description: 'The media profile or upload size is invalid.' },
        },
      },
    },
    '/media-assets/uploads/{uploadId}/complete': {
      post: {
        tags: ['Media'],
        summary: 'Validate a direct upload and enqueue processing',
        parameters: [uuidParameter('uploadId', 'Media upload ID')],
        responses: {
          201: responses.created,
          403: responses.forbidden,
          404: responses.notFound,
          409: { description: 'The upload was already completed.' },
        },
      },
    },
    '/media-assets/{mediaId}/playback-url': {
      post: {
        tags: ['Media'],
        summary: 'Create a short-lived private derivative playback URL',
        parameters: [uuidParameter('mediaId', 'Media asset ID')],
        responses: { 201: responses.created, 404: responses.notFound },
      },
    },
    '/media-assets/{mediaId}/retry-processing': {
      post: {
        tags: ['Media'],
        summary: 'Retry a failed real media-processing job',
        parameters: [uuidParameter('mediaId', 'Media asset ID')],
        responses: {
          201: responses.created,
          403: responses.forbidden,
          404: responses.notFound,
          409: { description: 'A processing job is already active.' },
        },
      },
    },
    '/media-assets/{mediaId}/simulate-successful-retry': {
      post: {
        tags: ['Media'],
        summary: 'Exercise the seeded legacy demo processing adapter',
        parameters: [uuidParameter('mediaId', 'Media asset ID')],
        responses: {
          201: responses.ok,
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/media-assets/{mediaId}/attach-to/{eventId}': {
      post: {
        tags: ['Media'],
        summary: 'Attach a ready asset to an event',
        parameters: [
          uuidParameter('mediaId', 'Media asset ID'),
          uuidParameter('eventId', 'Stream event ID'),
        ],
        responses: {
          201: responses.ok,
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/media-assets/{mediaId}/detach-from/{eventId}': {
      delete: {
        tags: ['Media'],
        summary: 'Detach an asset from an event',
        parameters: [
          uuidParameter('mediaId', 'Media asset ID'),
          uuidParameter('eventId', 'Stream event ID'),
        ],
        responses: {
          200: responses.ok,
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/stream-events/{eventId}/recommendations': {
      get: {
        tags: ['Launch control'],
        summary: 'List evidence-backed recommendations',
        parameters: [uuidParameter('eventId', 'Stream event ID')],
        responses: { 200: responses.ok, 404: responses.notFound },
      },
    },
    '/stream-events/{eventId}/recommendations/generate': {
      post: {
        tags: ['Launch control', 'AI assurance'],
        summary: 'Generate grounded advisory or apply deterministic fallback',
        parameters: [uuidParameter('eventId', 'Stream event ID')],
        responses: {
          201: responses.ok,
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/recommendations/{recommendationId}/resolve': {
      patch: {
        tags: ['Launch control'],
        summary: 'Resolve a recommendation with actor attribution',
        parameters: [uuidParameter('recommendationId', 'Recommendation ID')],
        responses: {
          200: responses.ok,
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/recommendation-evaluations/report': {
      get: {
        tags: ['AI assurance'],
        summary: 'Get the committed recommendation contract evaluation report',
        responses: { 200: responses.ok, 401: responses.unauthorized },
      },
    },
    '/recommendation-runs/{runId}/confirm': {
      post: {
        tags: ['AI assurance'],
        summary: 'Confirm a pending grounded AI advisory',
        parameters: [uuidParameter('runId', 'Recommendation run ID')],
        responses: {
          201: responses.ok,
          400: { description: 'The run is not awaiting confirmation.' },
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/recommendation-runs/{runId}/reject': {
      post: {
        tags: ['AI assurance'],
        summary: 'Reject a pending grounded AI advisory',
        parameters: [uuidParameter('runId', 'Recommendation run ID')],
        responses: {
          201: responses.ok,
          400: { description: 'The run is not awaiting confirmation.' },
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/feature-flags': {
      get: {
        tags: ['AI assurance'],
        summary: 'List workspace feature flags and effective provider state',
        responses: { 200: responses.ok, 401: responses.unauthorized },
      },
    },
    '/feature-flags/{key}': {
      patch: {
        tags: ['AI assurance'],
        summary: 'Update a workspace feature flag',
        parameters: [
          {
            name: 'key',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['AI_RECOMMENDATIONS'] },
          },
        ],
        requestBody: jsonBody({
          $ref: '#/components/schemas/FeatureFlagUpdateRequest',
        }),
        responses: {
          200: responses.ok,
          400: { description: 'The feature flag is unknown.' },
          403: responses.forbidden,
        },
      },
    },
    '/analytics/overview': {
      get: {
        tags: ['Analytics'],
        summary: 'Get persisted operational KPI snapshots and reliability data',
        parameters: [
          {
            name: 'days',
            in: 'query',
            schema: { type: 'integer', minimum: 7, maximum: 90, default: 14 },
          },
        ],
        responses: { 200: responses.ok, 401: responses.unauthorized },
      },
    },
    '/analytics/refresh': {
      post: {
        tags: ['Analytics'],
        summary: "Capture or update today's operational snapshot",
        responses: {
          201: responses.ok,
          403: responses.forbidden,
        },
      },
    },
    '/analytics/export.csv': {
      get: {
        tags: ['Analytics'],
        summary: 'Export persisted analytics as CSV',
        parameters: [
          {
            name: 'days',
            in: 'query',
            schema: { type: 'integer', minimum: 7, maximum: 90, default: 30 },
          },
        ],
        responses: {
          200: {
            description: 'CSV export of daily operational snapshots.',
            content: { 'text/csv': { schema: { type: 'string' } } },
          },
          401: responses.unauthorized,
        },
      },
    },
    '/error-reports/client': {
      post: {
        tags: ['Error evidence'],
        summary: 'Capture an authenticated browser error report',
        requestBody: jsonBody({
          $ref: '#/components/schemas/ClientErrorReportRequest',
        }),
        responses: { 201: responses.created, 401: responses.unauthorized },
      },
    },
    '/error-reports': {
      get: {
        tags: ['Error evidence'],
        summary: 'List workspace error evidence for operational triage',
        responses: {
          200: responses.ok,
          403: responses.forbidden,
        },
      },
    },
    '/error-reports/{reportId}/resolve': {
      patch: {
        tags: ['Error evidence'],
        summary: 'Resolve a workspace error report with audit evidence',
        parameters: [uuidParameter('reportId', 'Error report ID')],
        responses: {
          200: responses.ok,
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/audit-logs': {
      get: {
        tags: ['Governance'],
        summary: 'List append-only workspace activity',
        parameters: [
          {
            name: 'eventId',
            in: 'query',
            schema: { type: 'string', format: 'uuid' },
          },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', minimum: 1 },
          },
          {
            name: 'pageSize',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 50 },
          },
        ],
        responses: {
          200: jsonResponse(
            { $ref: '#/components/schemas/AuditLogListResponse' },
            'Paginated append-only workspace activity.',
          ),
        },
      },
    },
    '/workspaces/current': {
      get: {
        tags: ['Governance'],
        summary: 'Get current workspace and memberships',
        responses: { 200: responses.ok },
      },
    },
    '/webhook-endpoints': {
      get: {
        tags: ['Integrations'],
        summary: 'List workspace webhook endpoints and subscriptions',
        responses: { 200: responses.ok, 401: responses.unauthorized },
      },
    },
    '/webhook-endpoints/demo': {
      post: {
        tags: ['Integrations'],
        summary: 'Create a safe signed demo endpoint',
        requestBody: jsonBody({
          $ref: '#/components/schemas/CreateDemoWebhookRequest',
        }),
        responses: {
          201: responses.created,
          403: responses.forbidden,
          409: { description: 'An endpoint with this name already exists.' },
        },
      },
    },
    '/webhook-deliveries': {
      get: {
        tags: ['Integrations'],
        summary: 'List signed webhook deliveries and attempts',
        parameters: [
          {
            name: 'status',
            in: 'query',
            schema: {
              enum: [
                'PENDING',
                'DELIVERING',
                'RETRYING',
                'SUCCEEDED',
                'FAILED',
              ],
            },
          },
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', minimum: 1 },
          },
          {
            name: 'pageSize',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 50 },
          },
        ],
        responses: { 200: responses.ok, 401: responses.unauthorized },
      },
    },
    '/webhook-deliveries/{deliveryId}/retry': {
      post: {
        tags: ['Integrations'],
        summary: 'Manually retry a failed webhook delivery',
        parameters: [uuidParameter('deliveryId', 'Webhook delivery ID')],
        responses: {
          201: responses.created,
          403: responses.forbidden,
          404: responses.notFound,
        },
      },
    },
    '/demo/webhook-receiver': {
      post: {
        tags: ['Integrations'],
        summary: 'Receive and verify a signed local demo webhook',
        security: [],
        responses: {
          201: responses.created,
          401: { description: 'Signature or replay-window validation failed.' },
          503: { description: 'Deterministic fail-once mode response.' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      accessCookie: { type: 'apiKey', in: 'cookie', name: 'opspilot_access' },
      refreshCookie: { type: 'apiKey', in: 'cookie', name: 'opspilot_refresh' },
    },
    schemas: {
      EventStatus: {
        type: 'string',
        enum: [
          'DRAFT',
          'CONFIGURING',
          'READY',
          'LIVE',
          'COMPLETED',
          'ARCHIVED',
          'CANCELLED',
        ],
      },
      ReadinessStatus: {
        type: 'string',
        enum: ['READY', 'AT_RISK', 'BLOCKED'],
      },
      Pagination: {
        type: 'object',
        required: ['page', 'pageSize', 'total'],
        properties: {
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 50 },
          total: { type: 'integer', minimum: 0 },
        },
      },
      Readiness: {
        type: 'object',
        required: [
          'score',
          'status',
          'criteria',
          'blockers',
          'ruleVersion',
          'assessedAt',
        ],
        properties: {
          score: { type: 'integer', minimum: 0, maximum: 100 },
          status: { $ref: '#/components/schemas/ReadinessStatus' },
          criteria: { type: 'array', items: { type: 'object' } },
          blockers: { type: 'array', items: { type: 'string' } },
          ruleVersion: { type: 'string' },
          assessedAt: { type: 'string', format: 'date-time' },
        },
      },
      EventSummary: {
        type: 'object',
        required: [
          'id',
          'title',
          'status',
          'scheduledStart',
          'scheduledEnd',
          'timezone',
          'readiness',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string' },
          status: { $ref: '#/components/schemas/EventStatus' },
          scheduledStart: { type: 'string', format: 'date-time' },
          scheduledEnd: { type: 'string', format: 'date-time' },
          timezone: { type: 'string' },
          expectedAttendees: { type: 'integer', minimum: 0 },
          readiness: { $ref: '#/components/schemas/Readiness' },
        },
      },
      EventListResponse: {
        type: 'object',
        required: ['items', 'pagination'],
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/EventSummary' },
          },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      AuditLogListResponse: {
        type: 'object',
        required: ['items', 'pagination'],
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'id',
                'action',
                'entityType',
                'entityId',
                'summary',
                'createdAt',
              ],
              properties: {
                id: { type: 'string', format: 'uuid' },
                action: { type: 'string' },
                entityType: { type: 'string' },
                entityId: { type: 'string' },
                summary: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'alex.morgan@opspilot.demo',
          },
          password: { type: 'string', format: 'password', minLength: 8 },
        },
      },
      AuthResponse: {
        type: 'object',
        required: ['user'],
        properties: {
          user: {
            type: 'object',
            required: [
              'id',
              'email',
              'name',
              'workspaceId',
              'workspaceName',
              'role',
            ],
            properties: {
              id: { type: 'string', format: 'uuid' },
              email: { type: 'string', format: 'email' },
              name: { type: 'string' },
              workspaceId: { type: 'string', format: 'uuid' },
              workspaceName: { type: 'string' },
              role: {
                enum: [
                  'ADMIN',
                  'OPERATIONS_MANAGER',
                  'CONTENT_OPERATOR',
                  'ANALYST',
                  'VIEWER',
                ],
              },
            },
          },
        },
      },
      CreateEventRequest: {
        type: 'object',
        required: [
          'title',
          'description',
          'scheduledStart',
          'scheduledEnd',
          'timezone',
          'expectedAttendees',
        ],
        properties: {
          title: { type: 'string', minLength: 3 },
          description: { type: 'string', minLength: 10 },
          scheduledStart: { type: 'string', format: 'date-time' },
          scheduledEnd: { type: 'string', format: 'date-time' },
          timezone: { type: 'string', example: 'Europe/London' },
          expectedAttendees: { type: 'integer', minimum: 0, maximum: 1000000 },
          ownerId: { type: 'string', format: 'uuid' },
        },
      },
      UpdateEventRequest: {
        allOf: [
          { $ref: '#/components/schemas/CreateEventRequest' },
          {
            type: 'object',
            description: 'All fields are optional for updates.',
          },
        ],
      },
      AccessPolicyRequest: {
        type: 'object',
        required: [
          'mode',
          'allowedDomains',
          'requiresConsent',
          'collectCompany',
          'collectJobTitle',
        ],
        properties: {
          mode: {
            enum: ['PUBLIC', 'REGISTRATION', 'EMAIL_DOMAIN', 'INVITE_ONLY'],
          },
          allowedDomains: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string' },
          },
          requiresConsent: { type: 'boolean' },
          collectCompany: { type: 'boolean' },
          collectJobTitle: { type: 'boolean' },
        },
      },
      ContentBlockRequest: {
        type: 'object',
        required: ['type', 'title', 'body'],
        properties: {
          type: {
            enum: ['HERO', 'AGENDA', 'SPEAKER', 'RESOURCE', 'ANNOUNCEMENT'],
          },
          title: { type: 'string', minLength: 2 },
          body: { type: 'string', minLength: 2 },
          isVisible: { type: 'boolean', default: true },
        },
      },
      CreateMediaUploadRequest: {
        type: 'object',
        required: ['name', 'kind', 'contentType', 'sizeBytes'],
        properties: {
          name: { type: 'string', maxLength: 200 },
          kind: { enum: ['VIDEO', 'AUDIO'] },
          contentType: {
            enum: [
              'video/mp4',
              'video/quicktime',
              'audio/mpeg',
              'audio/wav',
              'audio/x-wav',
              'audio/mp4',
            ],
          },
          sizeBytes: { type: 'integer', minimum: 1, maximum: 104857600 },
          description: { type: 'string', maxLength: 500 },
        },
      },
      CreateDemoWebhookRequest: {
        type: 'object',
        required: ['name', 'mode'],
        properties: {
          name: { type: 'string', maxLength: 120 },
          mode: { enum: ['SUCCESS', 'FAIL_ONCE'] },
        },
      },
      FeatureFlagUpdateRequest: {
        type: 'object',
        required: ['enabled'],
        additionalProperties: false,
        properties: { enabled: { type: 'boolean' } },
      },
      ClientErrorReportRequest: {
        type: 'object',
        required: ['message'],
        additionalProperties: false,
        properties: {
          message: { type: 'string', maxLength: 500 },
          stack: { type: 'string', maxLength: 8000 },
          path: { type: 'string', maxLength: 300 },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
} as const;
