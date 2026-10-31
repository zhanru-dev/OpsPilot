import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { AppModule } from '../src/app.module';
import { WorkerModule } from '../src/worker.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { DomainEventsService } from '../src/domain-events/domain-events.service';
import { StorageService } from '../src/infrastructure/storage/storage.service';
import { WebhookCryptoService } from '../src/integrations/webhook-crypto.service';
import { MediaProcessingProcessor } from '../src/media/media-processing.processor';
import { MEDIA_PROCESSING_QUEUE } from '../src/infrastructure/queues/queue.constants';
import type { MediaProcessingJobData } from '../src/media/media-processing.types';

jest.setTimeout(90000);
const run = promisify(execFile);
const workspaceId = '11111111-1111-4111-8111-111111111111';
const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Real media pipeline did not reach the expected state');
}
describe('Real media processing, correlation and recovery', () => {
  let app: INestApplication<App>, worker: INestApplicationContext;
  let db: PrismaService, store: StorageService, events: DomainEventsService;
  let manager: ReturnType<typeof request.agent>;
  let queue: Queue<MediaProcessingJobData>, receiver: Server;
  let directory: string, fixture: Buffer;
  const ids: string[] = [],
    endpoints: string[] = [],
    extraEvents: string[] = [];
  const received = new Set<string>();
  const sharedTrace = `media-regression-${randomUUID()}`;

  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
      throw Error('Isolated test database required');
    directory = await mkdtemp(join(tmpdir(), 'opspilot-media-regression-'));
    const path = join(directory, 'source.mp4');
    await run(ffmpeg!, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=24',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      path,
    ]);
    fixture = await readFile(path);
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    store = app.get(StorageService);
    events = app.get(DomainEventsService);
    queue = app.get(getQueueToken(MEDIA_PROCESSING_QUEUE));
    manager = request.agent(app.getHttpServer());
    await manager
      .post('/api/v1/auth/login')
      .send({ email: 'alex.morgan@opspilot.demo', password: 'DemoPass123!' })
      .expect(200);
    receiver = createServer((req, res) => {
      received.add(
        `${String(req.headers['x-opspilot-endpoint-id'])}:${String(req.headers['idempotency-key'])}`,
      );
      req.resume();
      res.writeHead(204);
      res.end();
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    const port = (receiver.address() as { port: number }).port;
    for (let i = 0; i < 2; i++) {
      const endpoint = await db.webhookEndpoint.create({
        data: {
          workspaceId,
          name: `Media test ${randomUUID()}`,
          url: `http://127.0.0.1:${port}/receive`,
          secretEncrypted: app.get(WebhookCryptoService).encrypt(randomUUID()),
          subscriptions: {
            create: [
              'media.processing.queued',
              'media.processing.completed',
              'media.processing.failed',
            ].map((eventType) => ({ eventType })),
          },
        },
      });
      endpoints.push(endpoint.id);
    }
    worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
  });

  afterAll(async () => {
    await worker?.close();
    if (db) {
      const assets = await db.mediaAsset.findMany({
        where: { id: { in: ids } },
        include: { variants: true },
      });
      await store.deleteObjects(
        assets.flatMap((a) => [
          ...(a.originalObjectKey ? [a.originalObjectKey] : []),
          ...a.variants.map((v) => v.objectKey),
        ]),
      );
      await db.domainEvent.deleteMany({
        where: {
          OR: [{ aggregateId: { in: ids } }, { id: { in: extraEvents } }],
        },
      });
      await db.webhookEndpoint.deleteMany({ where: { id: { in: endpoints } } });
      await db.mediaAsset.deleteMany({ where: { id: { in: ids } } });
    }
    await app?.close();
    if (receiver) await new Promise<void>((r) => receiver.close(() => r()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function upload(bytes: Buffer) {
    const response = await manager
      .post('/api/v1/media-assets/uploads')
      .send({
        name: `Media integration ${randomUUID()}`,
        kind: 'VIDEO',
        contentType: 'video/mp4',
        sizeBytes: bytes.length,
      })
      .expect(201);
    const intent = response.body as {
      assetId: string;
      uploadId: string;
      uploadUrl: string;
      requiredHeaders: Record<string, string>;
    };
    ids.push(intent.assetId);
    expect(
      (
        await fetch(intent.uploadUrl, {
          method: 'PUT',
          headers: intent.requiredHeaders,
          body: new Uint8Array(bytes),
        })
      ).status,
    ).toBe(200);
    await manager
      .post(`/api/v1/media-assets/uploads/${intent.uploadId}/complete`)
      .set('x-request-id', sharedTrace)
      .expect(201);
    return intent;
  }

  it('correlates distinct events and serializes concurrent recording of one logical event', async () => {
    const key = `test:${randomUUID()}`;
    const input = {
      workspaceId,
      type: 'test.media.phase',
      aggregateType: 'MediaAsset',
      aggregateId: randomUUID(),
      payload: {},
      traceId: sharedTrace,
      idempotencyKey: key,
    };
    const rows = await Promise.all(
      Array.from({ length: 5 }, () => events.record(input)),
    );
    extraEvents.push(rows[0].id);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(
      await db.outboxEvent.count({ where: { domainEventId: rows[0].id } }),
    ).toBe(1);
    const next = await events.record({
      ...input,
      idempotencyKey: key + ':next',
      type: 'test.media.next',
    });
    extraEvents.push(next.id);
    expect(next.traceId).toBe(rows[0].traceId);
    expect(next.id).not.toBe(rows[0].id);
  });

  it('persists actual bytes, completes processing once and delivers both phases to two subscribers', async () => {
    const intent = await upload(fixture);
    await until(
      async () =>
        (
          await db.mediaAsset.findUniqueOrThrow({
            where: { id: intent.assetId },
          })
        ).status === 'READY',
    );
    const asset = await db.mediaAsset.findUniqueOrThrow({
      where: { id: intent.assetId },
      include: { variants: true, processingJobs: true },
    });
    expect(asset.variants.map((v) => v.kind).sort()).toEqual([
      'PREVIEW',
      'THUMBNAIL',
    ]);
    expect(asset.processingProgress).toBe(100);
    expect(asset.processingJobs[0].status).toBe('SUCCEEDED');
    await store.downloadToFile(
      asset.originalObjectKey!,
      join(directory, 'stored.mp4'),
    );
    expect(digest(await readFile(join(directory, 'stored.mp4')))).toBe(
      digest(fixture),
    );
    await until(
      async () =>
        (await queue.getJob(asset.processingJobs[0].bullJobId!))
          ?.getState()
          .then((s) => s === 'completed') ?? false,
    );
    const job = await queue.getJob(asset.processingJobs[0].bullJobId!);
    expect(
      await worker.get(MediaProcessingProcessor).process(job!),
    ).toMatchObject({ idempotent: true });
    await manager
      .post(`/api/v1/media-assets/uploads/${intent.uploadId}/complete`)
      .expect(409);
    const phases = await db.domainEvent.findMany({
      where: { aggregateId: asset.id },
    });
    expect(phases.map((p) => p.type).sort()).toEqual([
      'media.processing.completed',
      'media.processing.queued',
    ]);
    expect(phases.every((p) => p.traceId === sharedTrace)).toBe(true);
    await until(
      async () =>
        (await db.webhookDelivery.count({
          where: {
            domainEventId: { in: phases.map((p) => p.id) },
            endpointId: { in: endpoints },
            status: 'SUCCEEDED',
          },
        })) === 4,
    );
    expect(
      endpoints.every((e) => phases.every((p) => received.has(`${e}:${p.id}`))),
    ).toBe(true);
    expect(
      await db.webhookDelivery.count({
        where: {
          domainEventId: { in: phases.map((p) => p.id) },
          endpointId: { in: endpoints },
        },
      }),
    ).toBe(4);
    const playback = await manager
      .post(`/api/v1/media-assets/${asset.id}/playback-url`)
      .expect(201);
    const body = playback.body as { source: string; url: string };
    expect(body.source).toBe('PRIVATE_STORAGE');
    expect(
      (await (await fetch(body.url)).arrayBuffer()).byteLength,
    ).toBeGreaterThan(0);
  });

  it('persists terminal failure, safely reconciles legacy stranded state and retries the retained source', async () => {
    const intent = await upload(Buffer.alloc(fixture.length));
    await until(
      async () =>
        (
          await db.mediaAsset.findUniqueOrThrow({
            where: { id: intent.assetId },
          })
        ).status === 'FAILED',
    );
    const failed = await db.mediaProcessingJob.findFirstOrThrow({
      where: { mediaId: intent.assetId },
      include: { attempts: true },
    });
    expect(failed.status).toBe('FAILED');
    expect(failed.attempts).toHaveLength(3);
    expect(failed.attempts.every((a) => a.status === 'FAILED')).toBe(true);
    expect(
      await db.domainEvent.count({
        where: { aggregateId: intent.assetId, type: 'media.processing.failed' },
      }),
    ).toBe(1);
    await until(
      async () =>
        (await queue.getJob(failed.bullJobId!))
          ?.getState()
          .then((s) => s === 'failed') ?? false,
    );
    const processor = worker.get(MediaProcessingProcessor);
    await processor.worker.pause();
    const command = [
      resolve('../../scripts/reconcile-media-processing.mjs'),
      '--workspace',
      workspaceId,
      '--job',
      failed.id,
    ];
    try {
      // Recreate only the historical DB mismatch, retaining the real FAILED queue
      // and stored original. The audit's evidence/data is not modified.
      await db.$transaction([
        db.mediaAsset.update({
          where: { id: intent.assetId },
          data: { status: 'PROCESSING', processingProgress: 90 },
        }),
        db.mediaProcessingJob.update({
          where: { id: failed.id },
          data: { status: 'PROCESSING', finishedAt: null },
        }),
        db.mediaProcessingAttempt.update({
          where: {
            processingJobId_attemptNumber: {
              processingJobId: failed.id,
              attemptNumber: 3,
            },
          },
          data: { status: 'PROCESSING', finishedAt: null },
        }),
      ]);
      const dry = JSON.parse((await run(process.execPath, command)).stdout) as {
        applied: boolean;
      };
      expect(dry.applied).toBe(false);
      expect(
        (
          await db.mediaAsset.findUniqueOrThrow({
            where: { id: intent.assetId },
          })
        ).status,
      ).toBe('PROCESSING');
      await expect(
        run(process.execPath, [
          command[0],
          '--workspace',
          randomUUID(),
          '--job',
          failed.id,
          '--apply',
        ]),
      ).rejects.toThrow();
      const repaired = JSON.parse(
        (await run(process.execPath, [...command, '--apply'])).stdout,
      ) as { applied: boolean };
      expect(repaired.applied).toBe(true);
      expect(
        (
          await db.mediaAsset.findUniqueOrThrow({
            where: { id: intent.assetId },
          })
        ).status,
      ).toBe('FAILED');
      expect(
        await db.domainEvent.count({
          where: {
            aggregateId: intent.assetId,
            type: 'media.processing.failed',
          },
        }),
      ).toBe(1);
    } finally {
      await processor.worker.resume();
    }
    expect(
      (
        await fetch(intent.uploadUrl, {
          method: 'PUT',
          headers: intent.requiredHeaders,
          body: new Uint8Array(fixture),
        })
      ).status,
    ).toBe(200);
    await manager
      .post(`/api/v1/media-assets/${intent.assetId}/retry-processing`)
      .set('x-request-id', sharedTrace)
      .expect(201);
    await until(
      async () =>
        (
          await db.mediaAsset.findUniqueOrThrow({
            where: { id: intent.assetId },
          })
        ).status === 'READY',
    );
    const jobs = await db.mediaProcessingJob.findMany({
      where: { mediaId: intent.assetId },
      orderBy: { createdAt: 'asc' },
    });
    expect(jobs.map((j) => j.status)).toEqual(['FAILED', 'SUCCEEDED']);
    expect(jobs.every((j) => j.traceId === sharedTrace)).toBe(true);
    await expect(
      run(process.execPath, [...command, '--apply']),
    ).rejects.toThrow();
  });
});
