import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createHash, randomUUID } from 'node:crypto';
import { fork, execFile, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest, type ClientRequest } from 'node:http';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/infrastructure/storage/storage.service';
import { AuditService } from '../src/audit/audit.service';
import { MediaCleanupProcessor } from '../src/media/media-cleanup.processor';
import { MediaQueueRecoveryService } from '../src/media/media-queue-recovery.service';
import type { UploadReceipt, PartGrant } from '@opspilot/media-contracts';
import type { MediaProcessingJobData } from '../src/media/media-processing.types';

jest.setTimeout(120000);
const workspaceId = '11111111-1111-4111-8111-111111111111';
const base = '/api/v1/media-assets';
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
type Intent = {
  assetId: string;
  uploadId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
};
type Signal = {
  event: string;
  result?: { stale?: boolean };
  localFile?: string;
  message?: string;
};
describe('Acceptance remediation with real storage, queue and live workers', () => {
  let app: INestApplication<App>;
  let db: PrismaService;
  let store: StorageService;
  let audit: AuditService;
  let queue: Queue<MediaProcessingJobData>;
  let cleanup: MediaCleanupProcessor;
  let manager: ReturnType<typeof request.agent>;
  let admin: ReturnType<typeof request.agent>;
  let dir: string;
  let bytes: Buffer;
  const ids: string[] = [];
  const children: ChildProcess[] = [];
  const pendingRequests: ClientRequest[] = [];
  const signals = new Map<ChildProcess, Signal[]>();
  const slowTimers = new Set<NodeJS.Timeout>();
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
      throw Error('Isolated database required');
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    store = app.get(StorageService);
    audit = app.get(AuditService);
    queue = app.get(getQueueToken('media-processing'));
    cleanup = new MediaCleanupProcessor(db, store, audit);
    manager = request.agent(app.getHttpServer());
    admin = request.agent(app.getHttpServer());
    await manager
      .post('/api/v1/auth/login')
      .send({ email: 'alex.morgan@opspilot.demo', password: 'DemoPass123!' })
      .expect(200);
    await admin
      .post('/api/v1/auth/login')
      .send({ email: 'jordan.lee@opspilot.demo', password: 'DemoPass123!' })
      .expect(200);
    dir = await mkdtemp(join(tmpdir(), 'media-remediation-'));
    const file = join(dir, 'source.mp4');
    await promisify(execFile)(ffmpeg!, [
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
      file,
    ]);
    bytes = await readFile(file);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    jest.restoreAllMocks();
    for (const timer of slowTimers) clearInterval(timer);
    for (const r of pendingRequests) r.destroy();
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const done = once(child, 'exit');
        child.kill('SIGTERM');
        await done;
      }
    if (db)
      for (const id of ids) {
        const asset = await db.mediaAsset.findUnique({
          where: { id },
          include: { uploads: true, processingJobs: true },
        });
        if (!asset) continue;
        for (const upload of asset.uploads)
          await store.abortMultipartForKey(upload.objectKey);
        for (const job of asset.processingJobs)
          await (await queue.getJob(job.bullJobId!))?.remove();
        await store.deleteObjects(
          await store.listOwnedObjects(asset.workspaceId, id),
        );
        await db.domainEvent.deleteMany({ where: { aggregateId: id } });
        await db.mediaAsset.delete({ where: { id } });
      }
    await app?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  async function intent() {
    const r = await manager
      .post(`${base}/uploads`)
      .send({
        name: `Fix ${randomUUID()}`,
        kind: 'VIDEO',
        contentType: 'video/mp4',
        sizeBytes: bytes.length,
      })
      .expect(201);
    const upload = r.body as Intent;
    ids.push(upload.assetId);
    await put(upload, bytes);
    return upload;
  }
  async function put(upload: Intent, body: Buffer) {
    expect(
      (
        await fetch(upload.uploadUrl, {
          method: 'PUT',
          headers: upload.requiredHeaders,
          body: new Uint8Array(body),
        })
      ).status,
    ).toBe(200);
  }
  const complete = (u: Intent) =>
    manager.post(`${base}/uploads/${u.uploadId}/complete`);
  async function original(id: string) {
    return db.mediaAsset.findUniqueOrThrow({
      where: { id },
      include: { variants: true },
    });
  }
  async function signal(child: ChildProcess, event: string) {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
      const found = signals
        .get(child)!
        .find((s) => s.event === event || s.event === 'error');
      if (found?.event === 'error') throw Error(found.message);
      if (found) return found;
      if (child.exitCode !== null || child.signalCode !== null)
        throw Error('Worker exited before barrier');
      await new Promise((r) => setTimeout(r, 25));
    }
    throw Error(`Missing ${event} barrier`);
  }
  async function start(id: string, barrier = '') {
    const job = await db.mediaProcessingJob.findFirstOrThrow({
      where: { mediaId: id },
    });
    const child = fork(
      resolve('../../scripts/media-live-fence-child.cjs'),
      [job.bullJobId!, barrier],
      {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { ...process.env, BROADCAST_ENABLED: 'false' },
      },
    );
    children.push(child);
    signals.set(child, []);
    child.on('message', (s: Signal) => signals.get(child)!.push(s));
    return child;
  }
  it('freezes legacy bytes before processing and resists signed URL replay, concurrent completion and owner spoofing', async () => {
    const u = await intent();
    await admin.post(`${base}/uploads/${u.uploadId}/complete`).expect(403);
    const results = await Promise.all([complete(u), complete(u)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const asset = await original(u.assetId);
    const upload = await db.mediaUpload.findUniqueOrThrow({
      where: { id: u.uploadId },
    });
    expect(asset.originalObjectKey).not.toBe(upload.objectKey);
    expect(asset.sourceSha256).toBe(hash(bytes));
    await put(u, Buffer.alloc(bytes.length, 7));
    expect(
      await store.sha256Object(asset.originalObjectKey!, bytes.length),
    ).toBe(hash(bytes));
    await signal(await start(u.assetId), 'done');
    expect((await original(u.assetId)).status).toBe('READY');
    await put(u, Buffer.alloc(bytes.length, 11));
    expect(
      await store.sha256Object(asset.originalObjectKey!, bytes.length),
    ).toBe(hash(bytes));
    expect((await original(u.assetId)).status).toBe('READY');
    expect(
      await db.mediaProcessingJob.count({ where: { uploadId: u.uploadId } }),
    ).toBe(1);
    await complete(u).expect(409);
  });
  it('reuses a frozen copy after a real storage write and injected DB rollback, including historical ownerless intents', async () => {
    const u = await intent();
    const oldKey = `workspaces/${workspaceId}/media/${u.assetId}/original.mp4`;
    await store.uploadFile(oldKey, join(dir, 'source.mp4'), 'video/mp4');
    await db.mediaUpload.update({
      where: { id: u.uploadId },
      data: { objectKey: oldKey, ownerUserId: null },
    });
    await db.mediaAsset.update({
      where: { id: u.assetId },
      data: { originalObjectKey: oldKey },
    });
    u.uploadUrl = await store.createUploadUrl(
      oldKey,
      'video/mp4',
      bytes.length,
      600,
    );
    const record = audit.record.bind(audit);
    const fault = jest
      .spyOn(audit, 'record')
      .mockImplementation((input, tx) => {
        if (
          input.entityId === u.assetId &&
          input.action === 'media.processing_queued'
        )
          throw Error('Injected DB commit failure after real copy');
        return record(input, tx);
      });
    await complete(u).expect(500);
    fault.mockRestore();
    expect(
      (await db.mediaUpload.findUniqueOrThrow({ where: { id: u.uploadId } }))
        .status,
    ).toBe('FINALIZING');
    expect(
      await db.mediaProcessingJob.count({ where: { mediaId: u.assetId } }),
    ).toBe(0);
    const copies = (
      await store.listOwnedObjects(workspaceId, u.assetId)
    ).filter((k) => k.includes('/originals/'));
    expect(copies).toHaveLength(1);
    await put(u, Buffer.alloc(bytes.length, 8));
    await complete(u).expect(201);
    const asset = await original(u.assetId);
    expect(asset.originalObjectKey).toBe(copies[0]);
    expect(asset.sourceSha256).toBe(hash(bytes));
    expect(await store.sha256Object(copies[0], bytes.length)).toBe(hash(bytes));
  });
  it('rejects a source replacement between HEAD and conditional copy without registering an asset', async () => {
    const u = await intent();
    const copy = store.copyObject.bind(store);
    const fault = jest
      .spyOn(store, 'copyObject')
      .mockImplementationOnce(async (...args) => {
        await put(u, Buffer.alloc(bytes.length, 9));
        return copy(...args); // Actual MinIO CopySourceIfMatch must reject, not a mock result.
      });
    await complete(u).expect(409);
    fault.mockRestore();
    expect(
      await db.mediaProcessingJob.count({ where: { mediaId: u.assetId } }),
    ).toBe(0);
    expect(
      (await store.listOwnedObjects(workspaceId, u.assetId)).some((k) =>
        k.includes('/originals/'),
      ),
    ).toBe(false);
    await put(u, bytes);
    await complete(u).expect(201);
    expect((await original(u.assetId)).sourceSha256).toBe(hash(bytes));
  });
  it('keeps the selected source version after an uncertain copy failure instead of accepting changed staging', async () => {
    const u = await intent();
    const fault = jest
      .spyOn(store, 'copyObject')
      .mockRejectedValueOnce(
        new Error('Injected uncertain storage transport failure'),
      );
    await complete(u).expect(500);
    fault.mockRestore();
    const selected = await db.mediaUpload.findUniqueOrThrow({
      where: { id: u.uploadId },
    });
    expect(selected.snapshotSourceEtag).toBeTruthy();
    await put(u, Buffer.alloc(bytes.length, 3));
    await complete(u).expect(409);
    expect(
      (await db.mediaUpload.findUniqueOrThrow({ where: { id: u.uploadId } }))
        .snapshotSourceEtag,
    ).toBe(selected.snapshotSourceEtag);
    expect(
      await db.mediaProcessingJob.count({ where: { mediaId: u.assetId } }),
    ).toBe(0);
    await put(u, bytes);
    await complete(u).expect(201);
    expect((await original(u.assetId)).sourceSha256).toBe(hash(bytes));
  });
  it('aborts a real multipart transfer spanning grant expiry and cleanup without publishing cancelled media', async () => {
    const u = (
      await manager
        .post(`${base}/multipart`)
        .send({
          clientOperationId: randomUUID(),
          name: 'Slow actual part.mp4',
          kind: 'VIDEO',
          contentType: 'video/mp4',
          sizeBytes: bytes.length,
          hashes: [hash(bytes)],
        })
        .expect(201)
    ).body as UploadReceipt;
    ids.push(u.assetId);
    const grant = (
      await manager.post(`${base}/multipart/${u.id}/parts/1`).expect(201)
    ).body as PartGrant;
    const upload = await db.mediaUpload.findUniqueOrThrow({
      where: { id: u.id },
    });
    const req = httpRequest(grant.url, {
      method: 'PUT',
      headers: {
        ...grant.headers,
        'content-length': bytes.length,
        expect: '100-continue',
      },
    });
    pendingRequests.push(req);
    const response = new Promise<{ status: number; code: string | null }>(
      (resolve, reject) => {
        req.once('response', (r) => {
          let body = '';
          r.setEncoding('utf8');
          r.on('data', (chunk: string) => {
            body += chunk;
          });
          r.once('end', () =>
            resolve({
              status: r.statusCode!,
              code: body.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? null,
            }),
          );
        });
        req.once('error', reject);
      },
    );
    const admitted = once(req, 'continue');
    req.flushHeaders();
    await admitted;
    let sent = 1;
    req.write(bytes.subarray(0, sent));
    // Keep the real request active across the 60 s grant without triggering
    // MinIO's idle-body timeout; the remainder is released after cleanup.
    const heartbeat = setInterval(() => {
      req.write(bytes.subarray(sent, ++sent));
    }, 1000);
    slowTimers.add(heartbeat);
    req.once('response', () => clearInterval(heartbeat));
    await manager.post(`${base}/multipart/${u.id}/cancel`).expect(201);
    await new Promise((r) =>
      setTimeout(
        r,
        Math.max(0, new Date(grant.expiresAt).getTime() - Date.now()) + 1100,
      ),
    );
    await cleanup.reconcile();
    expect((await original(u.assetId)).cleanupPending).toBe(false);
    clearInterval(heartbeat);
    req.end(bytes.subarray(sent));
    const { status, code } = await response;
    console.info(
      JSON.stringify({ boundary: 'slow-multipart-after-abort', status, code }),
    );
    // MinIO may accept an already admitted body or reject its aborted upload ID;
    // either case must leave no original, live multipart session or processing job.
    expect([200, 404]).toContain(status);
    await cleanup.reconcile();
    await expect(
      store.listParts(upload.objectKey, upload.multipartId!),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(await store.listOwnedObjects(workspaceId, u.assetId)).toEqual([]);
    expect(
      (await db.mediaUpload.findUniqueOrThrow({ where: { id: u.id } })).status,
    ).toBe('CANCELLED');
    expect((await original(u.assetId)).status).toBe('DELETED');
    expect(
      await db.mediaProcessingJob.count({ where: { mediaId: u.assetId } }),
    ).toBe(0);
    await manager.post(`${base}/multipart/${u.id}/complete`).expect(409);
  });
  it('collects a real PUT admitted before expiry that finishes after deletion cleanup', async () => {
    const config = app.get(ConfigService);
    const ttl = config.get<number>('MEDIA_UPLOAD_URL_TTL_SECONDS');
    config.set('MEDIA_UPLOAD_URL_TTL_SECONDS', 10);
    let u: Intent;
    try {
      u = await intent();
    } finally {
      config.set('MEDIA_UPLOAD_URL_TTL_SECONDS', ttl);
    }
    await complete(u).expect(201);
    await signal(await start(u.assetId), 'done');
    const admitted = new Promise<void>((resolve, reject) => {
      const req = httpRequest(u.uploadUrl, {
        method: 'PUT',
        headers: {
          ...u.requiredHeaders,
          'content-length': bytes.length,
          expect: '100-continue',
        },
      });
      pendingRequests.push(req);
      req.once('error', reject);
      req.once('continue', () => {
        req.write(bytes.subarray(0, 1));
        resolve();
      });
      req.flushHeaders();
    });
    await admitted;
    const req = pendingRequests[pendingRequests.length - 1];
    const result = new Promise<number>((resolve, reject) => {
      req.once('response', (r) => {
        r.resume();
        r.once('end', () => resolve(r.statusCode!));
      });
      req.once('error', reject);
    });
    await manager.delete(`${base}/${u.assetId}`).expect(200);
    await new Promise((r) =>
      setTimeout(
        r,
        Math.max(0, new Date(u.expiresAt).getTime() - Date.now()) + 1100,
      ),
    );
    await cleanup.reconcile();
    expect(await store.listOwnedObjects(workspaceId, u.assetId)).toEqual([]);
    expect((await original(u.assetId)).cleanupPending).toBe(false);
    req.end(bytes.subarray(1));
    expect(await result).toBe(200); // Proves a late write actually occurred on this storage.
    const upload = await db.mediaUpload.findUniqueOrThrow({
      where: { id: u.uploadId },
    });
    expect(await store.listOwnedObjects(workspaceId, u.assetId)).toEqual([
      upload.objectKey,
    ]);
    await cleanup.reconcile();
    expect(await store.listOwnedObjects(workspaceId, u.assetId)).toEqual([]);
    expect((await original(u.assetId)).status).toBe('DELETED');
    await complete(u).expect(409);
    const count = await db.auditLog.count({
      where: { entityId: u.assetId, action: 'media.cleanup_completed' },
    });
    await cleanup.reconcile();
    expect(
      await db.auditLog.count({
        where: { entityId: u.assetId, action: 'media.cleanup_completed' },
      }),
    ).toBe(count);
  });
  it('advances past 100 healthy delayed jobs and a failing item without changing their business timestamps', async () => {
    const jobs = Array.from({ length: 102 }, () => randomUUID()).sort();
    for (let i = 0; i < jobs.length; i++) {
      const mediaId = randomUUID();
      const id = jobs[i];
      ids.push(mediaId);
      await db.mediaAsset.create({
        data: {
          id: mediaId,
          workspaceId,
          name: 'Fair recovery fixture',
          kind: 'VIDEO',
          status: 'PROCESSING',
          sizeBytes: 1,
          processingJobs: { create: { id, bullJobId: `media-${id}` } },
        },
      });
      if (i < 101)
        await queue.add(
          'process-media',
          { processingJobId: id, mediaId, workspaceId, traceId: id },
          { jobId: `media-${id}`, delay: 3600000 },
        );
    }
    const before = await db.mediaProcessingJob.findMany({
      where: { id: { in: jobs.slice(0, 101) } },
      orderBy: { id: 'asc' },
    });
    const getJob = queue.getJob.bind(queue);
    jest.spyOn(queue, 'getJob').mockImplementation(async (id) => {
      if (id === `media-${jobs[0]}`) throw Error('One queue lookup failed');
      return getJob(id);
    });
    const recovery = new MediaQueueRecoveryService(db, queue);
    // Other isolated fixtures can appear in the same bounded sweep; never reset data.
    for (let i = 0; i < 4 && !(await getJob(`media-${jobs[101]}`)); i++)
      await recovery.reconcile();
    expect(await getJob(`media-${jobs[101]}`)).toBeDefined();
    const after = await db.mediaProcessingJob.findMany({
      where: { id: { in: jobs.slice(0, 101) } },
      orderBy: { id: 'asc' },
    });
    expect(after.map((j) => j.updatedAt)).toEqual(
      before.map((j) => j.updatedAt),
    );
    // Full wrap also recovers a subsequently lost early job.
    await (await getJob(`media-${jobs[1]}`))!.remove();
    for (let i = 0; i < 4 && !(await getJob(`media-${jobs[1]}`)); i++)
      await recovery.reconcile();
    expect(await getJob(`media-${jobs[1]}`)).toBeDefined();
  });
  it.each(['progress', 'write', 'commit'])(
    'fences a still-alive old worker at the %s boundary after another process completes',
    async (barrier) => {
      const u = await intent();
      await complete(u).expect(201);
      const a = await start(u.assetId, barrier);
      const held = await signal(a, 'held');
      expect(a.exitCode).toBeNull();
      const old = await db.mediaProcessingJob.findUniqueOrThrow({
        where: { uploadId: u.uploadId },
      });
      const b = await start(u.assetId);
      await signal(b, 'done');
      const winner = await db.mediaProcessingJob.findUniqueOrThrow({
        where: { uploadId: u.uploadId },
      });
      const asset = await original(u.assetId);
      expect(winner.executionVersion).toBeGreaterThan(old.executionVersion);
      expect(winner.status).toBe('SUCCEEDED');
      expect(asset.status).toBe('READY');
      const progress = (await queue.getJob(winner.bullJobId!))!.progress;
      const keys = await store.listOwnedObjects(workspaceId, u.assetId);
      a.send('resume');
      const result = await signal(a, 'done');
      expect(result.result?.stale).toBe(true);
      expect((await queue.getJob(winner.bullJobId!))!.progress).toEqual(
        progress,
      );
      expect(await original(u.assetId)).toEqual(asset);
      expect(
        await db.mediaProcessingJob.findUniqueOrThrow({
          where: { id: winner.id },
        }),
      ).toEqual(winner);
      expect(await store.listOwnedObjects(workspaceId, u.assetId)).toEqual(
        keys,
      );
      expect(
        await db.domainEvent.count({
          where: { aggregateId: u.assetId, type: 'media.processing.completed' },
        }),
      ).toBe(1);
      await expect(access(held.localFile!)).rejects.toThrow();
      await cleanup.reconcile();
      expect(
        (await store.listOwnedObjects(workspaceId, u.assetId)).sort(),
      ).toEqual(
        [
          asset.originalObjectKey!,
          ...asset.variants.map((v) => v.objectKey),
        ].sort(),
      );
      expect(
        await store.sha256Object(asset.originalObjectKey!, bytes.length),
      ).toBe(hash(bytes));
    },
  );
});
