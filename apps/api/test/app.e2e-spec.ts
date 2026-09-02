import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Workspace } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('OpsPilot API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let manager: ReturnType<typeof request.agent>;
  let analyst: ReturnType<typeof request.agent>;
  let foreignWorkspace: Workspace;
  let foreignUserId: string;
  const createdEventIds: string[] = [];
  const createdEndpointIds: string[] = [];
  const createdDomainEventIds: string[] = [];
  const createdErrorReportIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    manager = request.agent(app.getHttpServer());
    analyst = request.agent(app.getHttpServer());
    await manager
      .post('/api/v1/auth/login')
      .send({
        email: 'alex.morgan@opspilot.demo',
        password: 'DemoPass123!',
      })
      .expect(200);
    await analyst
      .post('/api/v1/auth/login')
      .send({
        email: 'maya.chen@opspilot.demo',
        password: 'DemoPass123!',
      })
      .expect(200);

    foreignWorkspace = await prisma.workspace.create({
      data: {
        name: 'Isolation Test Workspace',
        slug: `isolation-${Date.now()}`,
      },
    });
    const foreignUser = await prisma.user.create({
      data: {
        email: `foreign-${Date.now()}@opspilot.test`,
        passwordHash: 'not-used-by-this-test',
        name: 'Foreign Workspace Owner',
        avatarInitials: 'FO',
        memberships: {
          create: {
            workspaceId: foreignWorkspace.id,
            role: 'OPERATIONS_MANAGER',
          },
        },
      },
    });
    foreignUserId = foreignUser.id;
  });

  afterAll(async () => {
    await prisma.errorReport.deleteMany({
      where: { id: { in: createdErrorReportIds } },
    });
    await prisma.webhookEndpoint.deleteMany({
      where: { id: { in: createdEndpointIds } },
    });
    await prisma.domainEvent.deleteMany({
      where: { id: { in: createdDomainEventIds } },
    });
    await prisma.streamEvent.deleteMany({
      where: { id: { in: createdEventIds } },
    });
    await prisma.workspace.delete({ where: { id: foreignWorkspace.id } });
    await prisma.user.delete({ where: { id: foreignUserId } });
    await app.close();
  });

  it('exposes public health checks and protects workspace APIs', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    const ready = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200);
    expect(ready.body as unknown).toMatchObject({
      status: 'ready',
      dependencies: { database: 'up', objectStorage: 'up', queues: 'up' },
    });
    await request(app.getHttpServer())
      .get('/api/v1/health/metrics')
      .expect(401);
    const metrics = await manager.get('/api/v1/health/metrics').expect(200);
    const metricsBody = metrics.body as unknown as {
      queues: Record<string, { waiting: number }>;
    };
    expect(Object.keys(metricsBody.queues).sort()).toEqual([
      'maintenance',
      'media',
      'outbox',
      'webhooks',
    ]);
    expect(typeof metricsBody.queues.media.waiting).toBe('number');
    await request(app.getHttpServer()).get('/api/v1/stream-events').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/demo')
      .send({ role: 'OPERATIONS_MANAGER' })
      .expect(404);
    const me = await manager.get('/api/v1/auth/me').expect(200);
    const meBody = me.body as unknown as {
      user: { role: string; workspaceName: string };
    };
    expect(meBody.user.role).toBe('OPERATIONS_MANAGER');
    expect(meBody.user.workspaceName).toBe('Brightline Events');
  });

  it('rejects browser mutations from an untrusted origin', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'https://untrusted.example')
      .send({
        email: 'alex.morgan@opspilot.demo',
        password: 'DemoPass123!',
      })
      .expect(403)
      .expect({
        statusCode: 403,
        message: 'Cross-origin mutation is not allowed.',
        error: 'Forbidden',
      });
  });

  it('provisions signed demo endpoints and authorises manual delivery retries', async () => {
    const endpointName = `E2E reliability endpoint ${Date.now()}`;
    await analyst
      .post('/api/v1/webhook-endpoints/demo')
      .send({ name: endpointName, mode: 'SUCCESS' })
      .expect(403);
    const endpointResponse = await manager
      .post('/api/v1/webhook-endpoints/demo')
      .send({ name: endpointName, mode: 'SUCCESS' })
      .expect(201);
    const endpointBody = endpointResponse.body as unknown as {
      endpoint: { id: string; subscriptions: Array<{ eventType: string }> };
      signingSecret: string;
    };
    createdEndpointIds.push(endpointBody.endpoint.id);
    expect(endpointBody.signingSecret).toHaveLength(64);
    expect(
      endpointBody.endpoint.subscriptions.map(({ eventType }) => eventType),
    ).toEqual(expect.arrayContaining(['event.ready', 'event.started']));

    const domainEvent = await prisma.domainEvent.create({
      data: {
        workspaceId: '11111111-1111-4111-8111-111111111111',
        type: 'test.delivery',
        aggregateType: 'StreamEvent',
        aggregateId: '33333333-3333-4333-8333-333333333332',
        payload: { test: true },
        traceId: `e2e-domain-${Date.now()}`,
      },
    });
    createdDomainEventIds.push(domainEvent.id);
    const delivery = await prisma.webhookDelivery.create({
      data: {
        workspaceId: domainEvent.workspaceId,
        domainEventId: domainEvent.id,
        endpointId: endpointBody.endpoint.id,
        status: 'FAILED',
        attemptCount: 1,
        responseStatus: 503,
        lastError: 'Synthetic retryable failure.',
        traceId: `e2e-delivery-${Date.now()}`,
      },
    });

    await manager
      .post(`/api/v1/webhook-deliveries/${delivery.id}/retry`)
      .expect(201)
      .expect({ queued: true, deliveryId: delivery.id });
    const list = await manager.get('/api/v1/webhook-deliveries').expect(200);
    const listBody = list.body as unknown as {
      items: Array<{ id: string }>;
    };
    expect(listBody.items).toContainEqual(
      expect.objectContaining({ id: delivery.id }),
    );
  });

  it('rotates refresh sessions without losing the authenticated user', async () => {
    await manager.post('/api/v1/auth/refresh').expect(200);
    await manager.post('/api/v1/auth/refresh').expect(200);
    await manager.get('/api/v1/auth/me').expect(200);
  });

  it('clears access and refresh cookies with their original paths', async () => {
    const session = request.agent(app.getHttpServer());
    await session
      .post('/api/v1/auth/login')
      .send({
        email: 'alex.morgan@opspilot.demo',
        password: 'DemoPass123!',
      })
      .expect(200);

    const response = await session.post('/api/v1/auth/logout').expect(204);
    const cookies = response.headers['set-cookie'] as unknown as string[];

    expect(cookies).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^opspilot_access=;.*Path=\//),
        expect.stringMatching(/^opspilot_refresh=;.*Path=\/api\/v1\/auth/),
      ]),
    );
  });

  it('creates a workspace-scoped event with an evidence-backed assessment', async () => {
    const response = await manager
      .post('/api/v1/stream-events')
      .send({
        title: 'E2E Launch Readiness Review',
        description: 'A temporary event created by the API integration test.',
        scheduledStart: '2027-02-18T10:00:00.000Z',
        scheduledEnd: '2027-02-18T11:00:00.000Z',
        timezone: 'Europe/London',
        expectedAttendees: 120,
      })
      .expect(201);

    const eventBody = response.body as unknown as {
      id: string;
      runbookItems: unknown[];
    };
    createdEventIds.push(eventBody.id);
    expect(response.body as unknown).toMatchObject({
      title: 'E2E Launch Readiness Review',
      status: 'DRAFT',
      readiness: { score: 20, status: 'BLOCKED', ruleVersion: '1.0' },
    });
    expect(eventBody.runbookItems).toHaveLength(2);
  });

  it('enforces analyst read-only permissions', async () => {
    const detail = await analyst
      .get(`/api/v1/stream-events/${createdEventIds[0]}`)
      .expect(200);
    const eventDetail = detail.body as unknown as {
      runbookItems: Array<{ id: string }>;
    };

    await analyst
      .patch(`/api/v1/runbook-items/${eventDetail.runbookItems[0].id}`)
      .send({ status: 'DONE' })
      .expect(403);
    await analyst.post('/api/v1/stream-events').send({}).expect(403);
  });

  it('rejects event owners who are not members of the workspace', async () => {
    await manager
      .post('/api/v1/stream-events')
      .send({
        title: 'Cross-tenant owner attempt',
        description: 'This request must fail before any event is persisted.',
        scheduledStart: '2027-04-18T10:00:00.000Z',
        scheduledEnd: '2027-04-18T11:00:00.000Z',
        timezone: 'Europe/London',
        expectedAttendees: 20,
        ownerId: foreignUserId,
      })
      .expect(400);

    await manager
      .patch(`/api/v1/stream-events/${createdEventIds[0]}`)
      .send({ ownerId: foreignUserId })
      .expect(400);
  });

  it('automatically reconciles recommendations when evidence changes', async () => {
    const eventId = createdEventIds[0];
    await manager
      .post(`/api/v1/stream-events/${eventId}/recommendations/generate`)
      .expect(201);

    await manager
      .put(`/api/v1/stream-events/${eventId}/access-policy`)
      .send({
        mode: 'REGISTRATION',
        allowedDomains: [],
        requiresConsent: true,
        collectCompany: true,
        collectJobTitle: false,
      })
      .expect(200);

    const recommendations = await manager
      .get(`/api/v1/stream-events/${eventId}/recommendations`)
      .expect(200);
    const body = recommendations.body as unknown as {
      items: Array<{ key: string; status: string }>;
    };
    expect(body.items).toContainEqual(
      expect.objectContaining({
        key: 'readiness-access-policy',
        status: 'RESOLVED',
      }),
    );
  });

  it('exposes grounded AI evaluation and deterministic fallback evidence', async () => {
    const evaluation = await manager
      .get('/api/v1/recommendation-evaluations/report')
      .expect(200);
    expect(evaluation.body as unknown).toMatchObject({
      promptVersion: '1.2',
      passed: 5,
      total: 5,
    });

    await analyst
      .patch('/api/v1/feature-flags/AI_RECOMMENDATIONS')
      .send({ enabled: true })
      .expect(403);
    const flag = await manager
      .patch('/api/v1/feature-flags/AI_RECOMMENDATIONS')
      .send({ enabled: true })
      .expect(200);
    expect(flag.body as unknown).toMatchObject({
      enabled: true,
      configured: false,
      effective: false,
    });

    const generated = await manager
      .post(
        `/api/v1/stream-events/${createdEventIds[0]}/recommendations/generate`,
      )
      .expect(201);
    expect(generated.body as unknown).toMatchObject({
      authoritativeProvider: 'DETERMINISTIC',
      latestRun: {
        provider: 'DETERMINISTIC',
        status: 'FALLBACK',
      },
    });
  });

  it('serves persisted analytics to both roles and protects refresh', async () => {
    const overview = await analyst
      .get('/api/v1/analytics/overview?days=14')
      .expect(200);
    const overviewBody = overview.body as unknown as {
      days: number;
      series: unknown[];
      kpis: { averageReadiness: number };
    };
    expect(overviewBody.days).toBe(14);
    expect(overviewBody.series).toHaveLength(14);
    expect(typeof overviewBody.kpis.averageReadiness).toBe('number');

    await analyst.post('/api/v1/analytics/refresh').expect(403);
    await manager.post('/api/v1/analytics/refresh').expect(201);

    const csv = await analyst
      .get('/api/v1/analytics/export.csv?days=14')
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    expect(csv.text).toContain('date,events_total');
    expect(csv.text.trim().split('\n')).toHaveLength(15);
  });

  it('captures client errors and restricts operational triage', async () => {
    const captured = await analyst
      .post('/api/v1/error-reports/client')
      .send({
        message: 'Synthetic browser recovery test',
        path: '/analytics',
        metadata: { boundary: 'analytics' },
      })
      .expect(201);
    const capturedBody = captured.body as unknown as {
      id: string;
      traceId: string;
    };
    createdErrorReportIds.push(capturedBody.id);
    expect(capturedBody.traceId).toEqual(expect.any(String));

    await analyst.get('/api/v1/error-reports').expect(403);
    const reports = await manager.get('/api/v1/error-reports').expect(200);
    const reportsBody = reports.body as unknown as {
      items: Array<{ id: string; status: string }>;
    };
    expect(reportsBody.items).toContainEqual(
      expect.objectContaining({ id: capturedBody.id, status: 'OPEN' }),
    );

    await manager
      .patch(`/api/v1/error-reports/${capturedBody.id}/resolve`)
      .expect(200)
      .expect(({ body }) => {
        expect(body as unknown).toMatchObject({
          report: { id: capturedBody.id, status: 'RESOLVED' },
        });
      });
  });

  it('attaches and detaches ready media with workspace checks', async () => {
    const readyAsset = await prisma.mediaAsset.findFirstOrThrow({
      where: { workspaceId: { not: foreignWorkspace.id }, status: 'READY' },
    });
    const eventId = createdEventIds[0];

    await manager
      .post(`/api/v1/media-assets/${readyAsset.id}/attach-to/${eventId}`)
      .expect(201);
    await manager
      .delete(`/api/v1/media-assets/${readyAsset.id}/detach-from/${eventId}`)
      .expect(200);

    const attachment = await prisma.eventMediaAsset.findUnique({
      where: { eventId_mediaId: { eventId, mediaId: readyAsset.id } },
    });
    expect(attachment).toBeNull();
  });

  it('creates and closes a workspace-scoped live operations session', async () => {
    const eventId = createdEventIds[0];
    const detail = await manager
      .get(`/api/v1/stream-events/${eventId}`)
      .expect(200);
    const runbookItems = (
      detail.body as unknown as {
        runbookItems: Array<{ id: string }>;
      }
    ).runbookItems;

    for (const item of runbookItems) {
      await manager
        .patch(`/api/v1/runbook-items/${item.id}`)
        .send({ status: 'DONE' })
        .expect(200);
    }
    await manager
      .post(`/api/v1/stream-events/${eventId}/transitions`)
      .send({ status: 'CONFIGURING' })
      .expect(201);
    await manager
      .post(`/api/v1/stream-events/${eventId}/transitions`)
      .send({ status: 'READY' })
      .expect(201);
    await manager
      .post(`/api/v1/stream-events/${eventId}/transitions`)
      .send({ status: 'LIVE' })
      .expect(201);

    const active = await manager
      .get(`/api/v1/stream-events/${eventId}/live-session`)
      .expect(200);
    const activeBody = active.body as unknown as {
      session: { id: string };
    };
    expect(activeBody).toMatchObject({
      event: { id: eventId, status: 'LIVE' },
      session: {
        status: 'ACTIVE',
        startedBy: { name: 'Alex Morgan' },
        updates: [
          expect.objectContaining({
            severity: 'INFO',
            message: 'E2E Launch Readiness Review went live.',
          }),
        ],
      },
    });

    await analyst
      .post(`/api/v1/stream-events/${eventId}/live-session/updates`)
      .send({ severity: 'WARNING', message: 'Read-only attempt.' })
      .expect(403);
    const updated = await manager
      .post(`/api/v1/stream-events/${eventId}/live-session/updates`)
      .send({
        severity: 'WARNING',
        message: 'Backup speaker is joining the session.',
      })
      .expect(201);
    const updatedBody = updated.body as unknown as {
      session: { updates: Array<{ severity: string; message: string }> };
    };
    expect(
      updatedBody.session.updates.some(
        (update) =>
          update.severity === 'WARNING' &&
          update.message === 'Backup speaker is joining the session.',
      ),
    ).toBe(true);

    const sessions = await analyst.get('/api/v1/live-sessions').expect(200);
    const sessionsBody = sessions.body as unknown as {
      items: Array<{
        eventId: string;
        status: string;
        _count: { updates: number };
      }>;
    };
    expect(
      sessionsBody.items.some(
        (session) =>
          session.eventId === eventId &&
          session.status === 'ACTIVE' &&
          session._count.updates === 2,
      ),
    ).toBe(true);

    await manager
      .post(`/api/v1/stream-events/${eventId}/transitions`)
      .send({ status: 'COMPLETED' })
      .expect(201);
    const ended = await manager
      .get(`/api/v1/stream-events/${eventId}/live-session`)
      .expect(200);
    const endedBody = ended.body as unknown as {
      event: { status: string };
      session: { status: string; endedBy: { name: string }; endedAt: unknown };
    };
    expect(endedBody).toMatchObject({
      event: { status: 'COMPLETED' },
      session: {
        status: 'ENDED',
        endedBy: { name: 'Alex Morgan' },
      },
    });
    expect(typeof endedBody.session.endedAt).toBe('string');
    await manager
      .post(`/api/v1/stream-events/${eventId}/live-session/updates`)
      .send({ severity: 'INFO', message: 'Late update.' })
      .expect(400);

    const evidence = await prisma.domainEvent.findMany({
      where: {
        aggregateId: { in: [eventId, activeBody.session.id] },
      },
      select: { id: true, type: true },
    });
    createdDomainEventIds.push(...evidence.map(({ id }) => id));
    expect(evidence.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        'event.ready',
        'event.started',
        'live-session.update.recorded',
        'event.completed',
      ]),
    );
    await expect(
      prisma.auditLog.findFirst({
        where: {
          eventId,
          action: 'live_session.update_recorded',
        },
      }),
    ).resolves.not.toBeNull();
  });

  it('treats archived events as immutable across mutation routes', async () => {
    const eventId = createdEventIds[0];
    const runbookItem = await prisma.runbookItem.findFirstOrThrow({
      where: { eventId },
    });
    await prisma.streamEvent.update({
      where: { id: eventId },
      data: { status: 'ARCHIVED' },
    });

    await manager
      .patch(`/api/v1/stream-events/${eventId}`)
      .send({ title: 'Archived events must not change' })
      .expect(400);
    await manager
      .patch(`/api/v1/runbook-items/${runbookItem.id}`)
      .send({ status: 'DONE' })
      .expect(400);
    await manager
      .post(`/api/v1/stream-events/${eventId}/recommendations/generate`)
      .expect(400);
  });

  it('returns 404 for a valid event that belongs to another workspace', async () => {
    const foreignEvent = await prisma.streamEvent.create({
      data: {
        workspaceId: foreignWorkspace.id,
        title: 'Foreign Event',
        slug: 'foreign-event',
        description: 'This event must remain invisible to the demo workspace.',
        scheduledStart: new Date('2027-03-01T10:00:00.000Z'),
        scheduledEnd: new Date('2027-03-01T11:00:00.000Z'),
      },
    });

    await manager.get(`/api/v1/stream-events/${foreignEvent.id}`).expect(404);
  });
});
