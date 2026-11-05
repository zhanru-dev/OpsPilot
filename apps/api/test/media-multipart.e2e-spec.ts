import { Prisma } from '@prisma/client';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AuditService } from '../src/audit/audit.service';
import { MediaCleanupProcessor } from '../src/media/media-cleanup.processor';
import { MediaQueueRecoveryService } from '../src/media/media-queue-recovery.service';
import { MEDIA_PROCESSING_QUEUE } from '../src/infrastructure/queues/queue.constants';
import type { MediaProcessingJobData } from '../src/media/media-processing.types';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createHash, randomUUID } from 'node:crypto';
import type { PartGrant, UploadReceipt } from '@opspilot/media-contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/infrastructure/storage/storage.service';
import { MediaService } from '../src/media/media.service';
import { PART_BYTES } from '../src/media/multipart.service';

jest.setTimeout(90000);
const base = '/api/v1/media-assets/multipart';
const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
describe('Multipart media with real PostgreSQL and MinIO', () => {
  let app: INestApplication<App>;
  let db: PrismaService;
  let storage: StorageService;
  let owner: ReturnType<typeof request.agent>;
  let second: ReturnType<typeof request.agent>;
  const ids: string[] = [];
  const bytes = Buffer.alloc(PART_BYTES * 2 + 171, 73);
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
      throw Error('Isolated database required');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    storage = app.get(StorageService);
    owner = request.agent(app.getHttpServer());
    second = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'alex.morgan@opspilot.demo', password: 'DemoPass123!' })
      .expect(200);
    await second
      .post('/api/v1/auth/login')
      .send({ email: 'jordan.lee@opspilot.demo', password: 'DemoPass123!' })
      .expect(200);
  });
  afterAll(async () => {
    for (const id of ids) {
      const row = await db.mediaUpload.findUnique({ where: { id } });
      if (!row) continue;
      for (const job of await db.mediaProcessingJob.findMany({
        where: { mediaId: row.mediaId },
      })) {
        const queue = app.get<Queue<MediaProcessingJobData>>(
          getQueueToken(MEDIA_PROCESSING_QUEUE),
        );
        await (await queue.getJob(job.bullJobId!))?.remove();
      }
      await storage.abortMultipartForKey(row.objectKey);
      await storage.deleteObjects([row.objectKey]);
      await db.domainEvent.deleteMany({ where: { aggregateId: row.mediaId } });
      await db.mediaAsset.delete({ where: { id: row.mediaId } });
    }
    await app?.close();
  });
  function input() {
    return {
      clientOperationId: randomUUID(),
      name: 'Multipart fixture.mp4',
      kind: 'VIDEO',
      contentType: 'video/mp4',
      sizeBytes: bytes.length,
      hashes: [0, 1, 2].map((i) =>
        digest(bytes.subarray(i * PART_BYTES, (i + 1) * PART_BYTES)),
      ),
    };
  }
  async function init() {
    const dto = input();
    const res = await owner.post(base).send(dto).expect(201);
    const row = res.body as UploadReceipt;
    ids.push(row.id);
    return { dto, row };
  }
  async function part(
    id: string,
    n: number,
    content = bytes.subarray((n - 1) * PART_BYTES, n * PART_BYTES),
  ) {
    const res = await owner.post(`${base}/${id}/parts/${n}`).expect(201);
    const grant = res.body as PartGrant;
    const result = await fetch(grant.url, {
      method: 'PUT',
      headers: grant.headers,
      body: new Uint8Array(content),
    });
    expect(result.status).toBe(200);
    return (await owner.post(`${base}/${id}/parts/${n}/confirm`).expect(201))
      .body as UploadReceipt;
  }
  it('reserves one asset, confirms exact boundaries and resumes only missing parts', async () => {
    const { dto, row } = await init();
    const duplicate = await owner.post(base).send(dto).expect(201);
    expect((duplicate.body as UploadReceipt).id).toBe(row.id);
    await owner
      .post(base)
      .send({ ...dto, name: 'different' })
      .expect(409);
    await owner.post(`${base}/${row.id}/parts/0`).expect(400);
    await owner.post(`${base}/${row.id}/complete`).expect(409);
    const first = await part(row.id, 1);
    expect(first.parts.map((p) => p.sizeBytes)).toEqual([PART_BYTES]);
    const restored = (await owner.get(`${base}/${row.id}`).expect(200))
      .body as UploadReceipt;
    expect(restored.parts).toEqual(first.parts);
    await part(row.id, 2);
    await part(row.id, 3);
    const responses = await Promise.all([
      owner.post(`${base}/${row.id}/complete`),
      owner.post(`${base}/${row.id}/complete`),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses.map((r) => (r.body as UploadReceipt).status)).toEqual([
      'UPLOADED',
      'UPLOADED',
    ]);
    const asset = await db.mediaAsset.findUniqueOrThrow({
      where: { id: row.assetId },
    });
    expect(asset.sourceSha256).toBe(digest(bytes));
    expect(
      await db.mediaProcessingJob.count({ where: { mediaId: row.assetId } }),
    ).toBe(1);
    await owner
      .post(`/api/v1/media-assets/uploads/${row.id}/complete`)
      .expect(400);
    expect(
      (
        (await owner.post(`${base}/${row.id}/cancel`).expect(201))
          .body as UploadReceipt
      ).status,
    ).toBe('UPLOADED');
  });
  it('recovers object completion when the database commit fails and keeps one processing intent', async () => {
    const { row } = await init();
    for (let n = 1; n <= 3; n++) await part(row.id, n);
    const fail = jest
      .spyOn(app.get(MediaService), 'registerUploaded')
      .mockRejectedValueOnce(new Error('controlled transaction failure'));
    await owner.post(`${base}/${row.id}/complete`).expect(503);
    fail.mockRestore();
    expect(
      (await db.mediaUpload.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe('FINALIZING');
    expect(
      (
        await storage.headObject(
          (await db.mediaUpload.findUniqueOrThrow({ where: { id: row.id } }))
            .objectKey,
        )
      ).contentLength,
    ).toBe(bytes.length);
    await owner.post(`${base}/${row.id}/complete`).expect(201);
    expect(
      await db.mediaProcessingJob.count({ where: { uploadId: row.id } }),
    ).toBe(1);
  });
  it('rejects unverified sessions, other owners and stale roles; cancellation cannot publish', async () => {
    const { row } = await init();
    await request(app.getHttpServer()).get(`${base}/${row.id}`).expect(401);
    await second.get(`${base}/${row.id}`).expect(403);
    await part(row.id, 1);
    const uid = '22222222-2222-4222-8222-222222222221';
    const wid = '11111111-1111-4111-8111-111111111111';
    const member = await db.workspaceMembership.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: wid, userId: uid } },
    });
    try {
      await db.workspaceMembership.update({
        where: { id: member.id },
        data: { role: 'VIEWER' },
      });
      await owner.post(`${base}/${row.id}/parts/2`).expect(403);
      await owner.post(`${base}/${row.id}/complete`).expect(403);
    } finally {
      await db.workspaceMembership.update({
        where: { id: member.id },
        data: { role: member.role },
      });
    }
    await owner.post(`${base}/${row.id}/cancel`).expect(201);
    await owner.post(`${base}/${row.id}/complete`).expect(409);
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: row.assetId } }))
        .status,
    ).toBe('DELETED');
    expect(
      await db.mediaProcessingJob.count({ where: { mediaId: row.assetId } }),
    ).toBe(0);
  });
  it('rejects altered bytes under the signed checksum', async () => {
    const { row } = await init();
    const grant = (await owner.post(`${base}/${row.id}/parts/1`).expect(201))
      .body as PartGrant;
    const response = await fetch(grant.url, {
      method: 'PUT',
      headers: grant.headers,
      body: new Uint8Array(Buffer.alloc(PART_BYTES, 74)),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    await owner.post(`${base}/${row.id}/parts/1/confirm`).expect(409);
  });
  it('linearizes cancellation against completion without publishing a cancelled asset', async () => {
    const { row } = await init();
    for (let n = 1; n <= 3; n++) await part(row.id, n);
    const results = await Promise.all([
      owner.post(`${base}/${row.id}/complete`),
      owner.post(`${base}/${row.id}/cancel`),
    ]);
    expect(results[1].status).toBe(201);
    expect([201, 409]).toContain(results[0].status);
    const final = await db.mediaUpload.findUniqueOrThrow({
      where: { id: row.id },
      include: { media: true },
    });
    const count = await db.mediaProcessingJob.count({
      where: { mediaId: row.assetId },
    });
    if (final.status === 'CANCELLED') {
      expect(final.media.status).toBe('DELETED');
      expect(count).toBe(0);
    } else {
      expect(final.status).toBe('UPLOADED');
      expect(final.media.status).toBe('PROCESSING');
      expect(count).toBe(1);
    }
  });

  it('keeps cleanup intent through storage failure and preserves a renewed upload during expiry', async () => {
    const { row } = await init();
    await part(row.id, 1);
    await owner.post(`${base}/${row.id}/cancel`).expect(201);
    await db.mediaAsset.update({
      where: { id: row.assetId },
      data: { cleanupAfter: new Date(0) },
    });
    const cleanup = new MediaCleanupProcessor(
      db,
      storage,
      app.get(AuditService),
    );
    const failure = jest
      .spyOn(storage, 'deleteObjects')
      .mockRejectedValueOnce(new Error('controlled storage failure'));
    await cleanup.reconcile();
    failure.mockRestore();
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: row.assetId } }))
        .cleanupPending,
    ).toBe(true);
    await cleanup.reconcile();
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: row.assetId } }))
        .cleanupPending,
    ).toBe(false);
    const fresh = (await init()).row;
    const live = await db.mediaUpload.findUniqueOrThrow({
      where: { id: fresh.id },
    });
    await db.mediaUpload.update({
      where: { id: fresh.id },
      data: {
        createdAt: new Date(Date.now() - 120000),
        expiresAt: new Date(Date.now() - 60000),
      },
    });
    let reconciling: Promise<unknown> | undefined;
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${fresh.assetId} FOR UPDATE`;
        reconciling = cleanup.reconcile();
        let waiting = false;
        for (let i = 0; i < 200; i++) {
          const rows = await db.$queryRaw<
            { waiting: boolean }[]
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%MediaAsset%') AS waiting`;
          if (rows[0].waiting) {
            waiting = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        expect(waiting).toBe(true);
        await tx.mediaUpload.update({
          where: { id: fresh.id },
          data: { expiresAt: live.expiresAt },
        });
      },
      { timeout: 10000 },
    );
    await reconciling;
    expect(
      (await db.mediaUpload.findUniqueOrThrow({ where: { id: fresh.id } }))
        .status,
    ).toBe('PENDING');
    await owner.post(`${base}/${fresh.id}/cancel`).expect(201);
  });

  it('retains durable processing intent after enqueue fails and recovers the same job', async () => {
    const { row } = await init();
    for (let n = 1; n <= 3; n++) await part(row.id, n);
    const queue = app.get<Queue<MediaProcessingJobData>>(
      getQueueToken(MEDIA_PROCESSING_QUEUE),
    );
    const failure = jest
      .spyOn(queue, 'add')
      .mockRejectedValueOnce(new Error('controlled Redis enqueue failure'));
    await owner.post(`${base}/${row.id}/complete`).expect(503);
    failure.mockRestore();
    const job = await db.mediaProcessingJob.findUniqueOrThrow({
      where: { uploadId: row.id },
    });
    expect(job.status).toBe('QUEUED');
    expect(await queue.getJob(job.bullJobId!)).toBeUndefined();
    const recovery = new MediaQueueRecoveryService(db, queue);
    await recovery.reconcile();
    expect(await queue.getJob(job.bullJobId!)).toBeDefined();
    await owner.post(`${base}/${row.id}/complete`).expect(201);
    expect(
      await db.mediaProcessingJob.count({ where: { uploadId: row.id } }),
    ).toBe(1);
  });

  it('rejects oversized manifests and an expired staff session even with a signed access token', async () => {
    await owner
      .post(base)
      .send({ ...input(), sizeBytes: 104857601 })
      .expect(400);
    await owner
      .post(base)
      .send({ ...input(), hashes: ['invalid'] })
      .expect(400);
    const { row } = await init();
    const sessions = await db.session.findMany({
      where: {
        userId: '22222222-2222-4222-8222-222222222221',
        revokedAt: null,
      },
    });
    try {
      await db.session.updateMany({
        where: { id: { in: sessions.map((x) => x.id) } },
        data: { revokedAt: new Date() },
      });
      await owner.get(`${base}/${row.id}`).expect(401);
      await owner.post(`${base}/${row.id}/parts/1`).expect(401);
    } finally {
      for (const session of sessions)
        await db.session.update({
          where: { id: session.id },
          data: { revokedAt: session.revokedAt },
        });
    }
  });
  it('keeps an old open session discoverable beyond fifty newer terminal receipts', async () => {
    const { row } = await init();
    const original = await db.mediaUpload.findUniqueOrThrow({
      where: { id: row.id },
    });
    const added: string[] = [];
    try {
      for (let i = 0; i < 52; i++) {
        const media = await db.mediaAsset.create({
          data: {
            workspaceId: original.workspaceId,
            name: 'Terminal receipt fixture',
            kind: 'VIDEO',
            status: 'DELETED',
          },
        });
        added.push(media.id);
        await db.mediaUpload.create({
          data: {
            workspaceId: original.workspaceId,
            mediaId: media.id,
            ownerUserId: original.ownerUserId,
            clientOperationId: randomUUID(),
            manifest: original.manifest as Prisma.InputJsonValue,
            expectedSizeBytes: original.expectedSizeBytes,
            contentType: original.contentType,
            objectKey: `unused/${media.id}`,
            status: 'CANCELLED',
            expiresAt: original.expiresAt,
          },
        });
      }
      const response = await owner.get(base).expect(200);
      const items = (response.body as { items: UploadReceipt[] }).items;
      expect(items).toHaveLength(50);
      expect(items.some((x) => x.id === row.id)).toBe(true);
    } finally {
      await db.mediaAsset.deleteMany({ where: { id: { in: added } } });
    }
    await owner.post(`${base}/${row.id}/cancel`).expect(201);
  });
  it('bounds issued part grants and denies fresh operations after revocation, including real URL expiry', async () => {
    const { row } = await init();
    const grant = (await owner.post(`${base}/${row.id}/parts/1`).expect(201))
      .body as PartGrant;
    expect(new URL(grant.url).searchParams.get('X-Amz-Expires')).toBe('60');
    const member = await db.workspaceMembership.findUniqueOrThrow({
      where: {
        workspaceId_userId: {
          workspaceId: '11111111-1111-4111-8111-111111111111',
          userId: '22222222-2222-4222-8222-222222222221',
        },
      },
    });
    try {
      await db.workspaceMembership.update({
        where: { id: member.id },
        data: { role: 'VIEWER' },
      });
      await owner.post(`${base}/${row.id}/parts/2`).expect(403);
      await owner.post(`${base}/${row.id}/complete`).expect(403);
      const put = () =>
        fetch(grant.url, {
          method: 'PUT',
          headers: grant.headers,
          body: new Uint8Array(bytes.subarray(0, PART_BYTES)),
        });
      expect((await put()).status).toBe(200);
      await new Promise((r) =>
        setTimeout(
          r,
          Math.max(0, new Date(grant.expiresAt).getTime() - Date.now() + 1500),
        ),
      );
      expect((await put()).status).toBe(403);
    } finally {
      await db.workspaceMembership.update({
        where: { id: member.id },
        data: { role: member.role },
      });
    }
    await owner.post(`${base}/${row.id}/cancel`).expect(201);
  });
  it('resumes the same reserved upload after S3 initialization failed and the client reloaded', async () => {
    const dto = input();
    const failure = jest
      .spyOn(storage, 'beginMultipart')
      .mockRejectedValueOnce(new Error('Controlled S3 initialization outage'));
    await owner.post(base).send(dto).expect(503);
    failure.mockRestore();
    const reserved = await db.mediaUpload.findFirstOrThrow({
      where: { clientOperationId: dto.clientOperationId },
    });
    ids.push(reserved.id);
    expect(reserved.multipartId).toBeNull();
    const restored = (await owner.get(`${base}/${reserved.id}`).expect(200))
      .body as UploadReceipt;
    expect(restored.assetId).toBe(reserved.mediaId);
    const receipt = await part(reserved.id, 1);
    expect(receipt.parts).toHaveLength(1);
    expect(
      (await db.mediaUpload.findUniqueOrThrow({ where: { id: reserved.id } }))
        .multipartId,
    ).not.toBeNull();
    expect(
      await db.mediaUpload.count({
        where: { clientOperationId: dto.clientOperationId },
      }),
    ).toBe(1);
    await owner.post(`${base}/${reserved.id}/cancel`).expect(201);
  });
});
