import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UploadReceipt } from '@opspilot/media-contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/infrastructure/storage/storage.service';
import { AuditService } from '../src/audit/audit.service';
import { MediaCleanupProcessor } from '../src/media/media-cleanup.processor';

jest.setTimeout(90000);
const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222221';
const base = '/api/v1/media-assets';
describe('Media security and storage recovery boundaries', () => {
  let app: INestApplication<App>;
  let db: PrismaService;
  let storage: StorageService;
  let manager: ReturnType<typeof request.agent>;
  let admin: ReturnType<typeof request.agent>;
  let dir: string;
  let file: string;
  const ids: string[] = [];
  const workspaces: string[] = [];
  const events: string[] = [];
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
    dir = await mkdtemp(join(tmpdir(), 'media-boundaries-'));
    file = join(dir, 'bytes');
    await writeFile(file, Buffer.alloc(100, 1));
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await db.streamEvent.deleteMany({ where: { id: { in: events } } });
    for (const id of ids) {
      const asset = await db.mediaAsset.findUnique({
        where: { id },
        include: { uploads: true },
      });
      if (!asset) continue;
      for (const u of asset.uploads)
        await storage.abortMultipartForKey(u.objectKey);
      await storage.deleteObjects(
        await storage.listOwnedObjects(asset.workspaceId, id),
      );
      await db.mediaAsset.delete({ where: { id } });
    }
    await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function ready(wid = workspaceId) {
    const id = randomUUID();
    const key = `workspaces/${wid}/media/${id}/original.mp4`;
    await storage.uploadFile(key, file, 'video/mp4');
    const asset = await db.mediaAsset.create({
      data: {
        id,
        workspaceId: wid,
        name: `Boundary ${id}`,
        kind: 'VIDEO',
        status: 'READY',
        sizeBytes: 100,
        originalObjectKey: key,
        variants: {
          create: {
            kind: 'PREVIEW',
            objectKey: key,
            contentType: 'video/mp4',
            sizeBytes: 100,
            profileVersion: 'v1',
          },
        },
      },
    });
    ids.push(id);
    return asset;
  }
  async function event(wid = workspaceId) {
    const id = randomUUID();
    events.push(id);
    return db.streamEvent.create({
      data: {
        id,
        workspaceId: wid,
        title: `Media boundary ${id}`,
        slug: id,
        description: 'Isolated fixture',
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 3600000),
      },
    });
  }
  it('denies cross-workspace media and event access while preserving legitimate reuse and referenced deletion protection', async () => {
    const foreign = await db.workspace.create({
      data: { name: 'Isolated media foreign', slug: randomUUID() },
    });
    workspaces.push(foreign.id);
    const a = await ready();
    const other = await ready(foreign.id);
    const one = await event();
    const two = await event();
    const outside = await event(foreign.id);
    const upload = await db.mediaUpload.create({
      data: {
        mediaId: other.id,
        workspaceId: foreign.id,
        ownerUserId: userId,
        clientOperationId: randomUUID(),
        manifest: {
          clientOperationId: randomUUID(),
          name: 'Foreign',
          kind: 'VIDEO',
          contentType: 'video/mp4',
          sizeBytes: 100,
          hashes: [],
        },
        expectedSizeBytes: 100,
        contentType: 'video/mp4',
        objectKey: other.originalObjectKey!,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    await manager.get(`${base}/multipart/${upload.id}`).expect(404);
    for (const route of ['parts/1', 'complete', 'cancel'])
      await manager.post(`${base}/multipart/${upload.id}/${route}`).expect(404);
    await manager.get(`${base}/${other.id}`).expect(404);
    await manager.post(`${base}/${other.id}/playback-url`).expect(404);
    await manager.delete(`${base}/${other.id}`).expect(404);
    await manager.post(`${base}/${a.id}/attach-to/${outside.id}`).expect(404);
    for (const e of [one, two])
      await manager.post(`${base}/${a.id}/attach-to/${e.id}`).expect(201);
    expect(await db.eventMediaAsset.count({ where: { mediaId: a.id } })).toBe(
      2,
    );
    await manager.delete(`${base}/${a.id}`).expect(409);
    for (const e of [one, two])
      await manager.delete(`${base}/${a.id}/detach-from/${e.id}`).expect(200);
    await manager.delete(`${base}/${a.id}`).expect(200);
    await manager.post(`${base}/${a.id}/playback-url`).expect(404);
  });
  it('rechecks membership after a queued URL request and documents the existing bearer grant window', async () => {
    const a = await ready();
    const grant = (
      await manager.post(`${base}/${a.id}/playback-url`).expect(201)
    ).body as { url: string };
    expect(new URL(grant.url).searchParams.get('X-Amz-Expires')).toBe('300');
    expect((await fetch(grant.url.split('?')[0])).status).toBe(403);
    const membership = await db.workspaceMembership.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    let pending: Promise<request.Response> | undefined;
    try {
      await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${a.id} FOR UPDATE`;
          pending = manager.post(`${base}/${a.id}/playback-url`).then((x) => x);
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
          await db.workspaceMembership.delete({ where: { id: membership.id } });
        },
        { timeout: 10000 },
      );
      expect((await pending)!.status).toBe(403);
      await manager.get(base).expect(403);
      expect((await fetch(grant.url)).status).toBe(200);
    } finally {
      await db.workspaceMembership.create({ data: membership });
    }
  });
  it('permits manager cancellation of another owner without granting resume or completion', async () => {
    const result = await manager
      .post(`${base}/multipart`)
      .send({
        clientOperationId: randomUUID(),
        name: 'Owned.mp4',
        kind: 'VIDEO',
        contentType: 'video/mp4',
        sizeBytes: 100,
        hashes: [
          createHash('sha256').update(Buffer.alloc(100, 1)).digest('hex'),
        ],
      })
      .expect(201);
    const u = result.body as UploadReceipt;
    ids.push(u.assetId);
    await admin.get(`${base}/multipart/${u.id}`).expect(403);
    await admin.post(`${base}/multipart/${u.id}/parts/1`).expect(403);
    await admin.post(`${base}/multipart/${u.id}/complete`).expect(403);
    await admin.post(`${base}/multipart/${u.id}/cancel`).expect(201);
    expect(
      (await db.mediaUpload.findUniqueOrThrow({ where: { id: u.id } })).status,
    ).toBe('CANCELLED');
  });
  it('retries cleanup after storage deletion succeeds but the database transaction rolls back', async () => {
    const a = await ready();
    await manager.delete(`${base}/${a.id}`).expect(200);
    const audit = app.get(AuditService);
    const original = audit.record.bind(audit);
    const failure = jest
      .spyOn(audit, 'record')
      .mockImplementation((input, tx) => {
        if (
          input.action === 'media.cleanup_completed' &&
          input.entityId === a.id
        )
          throw Error('Controlled DB commit failure');
        return original(input, tx);
      });
    const cleanup = new MediaCleanupProcessor(db, storage, audit);
    await cleanup.reconcile();
    failure.mockRestore();
    expect(await storage.listOwnedObjects(workspaceId, a.id)).toEqual([]);
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: a.id } }))
        .cleanupPending,
    ).toBe(true);
    expect(await db.mediaVariant.count({ where: { mediaId: a.id } })).toBe(1);
    await cleanup.reconcile();
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: a.id } }))
        .cleanupPending,
    ).toBe(false);
    expect(await db.mediaVariant.count({ where: { mediaId: a.id } })).toBe(0);
  });
  it('detects missing stored originals, removes orphan outputs, and retains valid registered objects', async () => {
    const a = await ready();
    const orphan = `workspaces/${workspaceId}/media/${a.id}/variants/abandoned/output`;
    await storage.uploadFile(orphan, file, 'application/octet-stream');
    const cleanup = new MediaCleanupProcessor(
      db,
      storage,
      app.get(AuditService),
    );
    await cleanup.reconcile();
    expect(await storage.listOwnedObjects(workspaceId, a.id)).toEqual([
      a.originalObjectKey,
    ]);
    await storage.deleteObjects([a.originalObjectKey!]);
    await manager.post(`${base}/${a.id}/playback-url`).expect(503);
    await cleanup.reconcile();
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: a.id } })).status,
    ).toBe('FAILED');
  });
  it('serializes concurrent initialization against the twelve-session owner quota', async () => {
    const seed = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const user = await db.user.create({
      data: {
        email: `media-quota-${randomUUID()}@test.invalid`,
        passwordHash: seed.passwordHash,
        name: 'Quota fixture',
        avatarInitials: 'QT',
        memberships: { create: { workspaceId, role: 'CONTENT_OPERATOR' } },
      },
    });
    try {
      const client = request.agent(app.getHttpServer());
      await client
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'DemoPass123!' })
        .expect(200);
      const responses = await Promise.all(
        Array.from({ length: 13 }, () =>
          client.post(`${base}/multipart`).send({
            clientOperationId: randomUUID(),
            name: 'Quota.mp4',
            kind: 'VIDEO',
            contentType: 'video/mp4',
            sizeBytes: 100,
            hashes: [
              createHash('sha256').update(Buffer.alloc(100, 1)).digest('hex'),
            ],
          }),
        ),
      );
      expect(responses.filter((r) => r.status === 201)).toHaveLength(12);
      expect(responses.filter((r) => r.status === 409)).toHaveLength(1);
      expect(
        await db.mediaUpload.count({
          where: { ownerUserId: user.id, status: 'PENDING' },
        }),
      ).toBe(12);
      const first = responses.find((r) => r.status === 201)!
        .body as UploadReceipt;
      await client.post(`${base}/multipart/${first.id}/cancel`).expect(201);
      const next = await client
        .post(`${base}/multipart`)
        .send({
          clientOperationId: randomUUID(),
          name: 'Released slot.mp4',
          kind: 'VIDEO',
          contentType: 'video/mp4',
          sizeBytes: 100,
          hashes: [
            createHash('sha256').update(Buffer.alloc(100, 1)).digest('hex'),
          ],
        })
        .expect(201);
      expect(next.body).toHaveProperty('id');
    } finally {
      const uploads = await db.mediaUpload.findMany({
        where: { ownerUserId: user.id },
      });
      for (const u of uploads) {
        await storage.abortMultipartForKey(u.objectKey);
        await storage.deleteObjects([u.objectKey]);
        await db.mediaAsset.delete({ where: { id: u.mediaId } });
      }
      await db.user.delete({ where: { id: user.id } });
    }
  });
});
