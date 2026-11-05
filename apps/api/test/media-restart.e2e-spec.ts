import { fork, type ChildProcess, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import ffmpeg from 'ffmpeg-static';
import { StorageService } from '../src/infrastructure/storage/storage.service';
import type { PartGrant, UploadReceipt } from '@opspilot/media-contracts';

jest.setTimeout(150000);
type Signal = { event: string; url?: string };
describe('Media recovery across actual API and worker process death', () => {
  const db = new PrismaClient();
  const children: ChildProcess[] = [];
  const signals = new Map<ChildProcess, Signal[]>();
  let assetId: string | undefined;
  let directory: string;
  let upload: UploadReceipt;
  let bytes: Buffer;
  let api: ChildProcess;
  let cookie: string;
  let url: string;
  let storage: StorageService;
  const redis = new URL(process.env.REDIS_URL!);
  const queue = new Queue('media-processing', {
    connection: {
      host: redis.hostname,
      port: Number(redis.port),
      db: Number(redis.pathname.slice(1) || 0),
    },
  });
  async function signal(child: ChildProcess, event: string, timeout = 90000) {
    const limit = Date.now() + timeout;
    while (Date.now() < limit) {
      const found = signals.get(child)!.find((x) => x.event === event);
      if (found) return found;
      if (child.exitCode !== null || child.signalCode !== null)
        throw Error('Test child exited before expected boundary');
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error(`Missing child boundary: ${event}`);
  }
  async function start(kind: 'api' | 'worker', hold = false) {
    const child = fork(
      resolve('../../scripts/media-restart-child.cjs'),
      [kind, ...(hold ? ['hold'] : [])],
      {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { ...process.env, BROADCAST_ENABLED: 'false' },
      },
    );
    children.push(child);
    signals.set(child, []);
    child.on('message', (m: Signal) => signals.get(child)!.push(m));
    const ready = await signal(child, 'ready');
    return { child, url: ready.url! };
  }
  async function kill(child: ChildProcess) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  async function call(path: string, body?: unknown) {
    return fetch(`${url}/api/v1${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
      throw Error('Isolated database required');
    storage = new StorageService(
      new ConfigService({
        ...process.env,
        S3_FORCE_PATH_STYLE: true,
        S3_AUTO_CREATE_BUCKET: true,
      }),
    );
    directory = await mkdtemp(join(tmpdir(), 'media-restart-'));
    const path = join(directory, 'source.mp4');
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
      path,
    ]);
    bytes = await readFile(path);
    ({ child: api, url } = await start('api', true));
    const login = await fetch(`${url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alex.morgan@opspilot.demo',
        password: 'DemoPass123!',
      }),
    });
    expect(login.status).toBe(200);
    cookie = login.headers
      .getSetCookie()
      .map((x) => x.split(';')[0])
      .join('; ');
    const result = await call('/media-assets/multipart', {
      clientOperationId: randomUUID(),
      name: `Restart ${randomUUID()}`,
      kind: 'VIDEO',
      contentType: 'video/mp4',
      sizeBytes: bytes.length,
      hashes: [createHash('sha256').update(bytes).digest('hex')],
    });
    expect(result.status).toBe(201);
    upload = (await result.json()) as UploadReceipt;
    assetId = upload.assetId;
    const grant = (await (
      await call(`/media-assets/multipart/${upload.id}/parts/1`)
    ).json()) as PartGrant;
    expect(
      (
        await fetch(grant.url, {
          method: 'PUT',
          headers: grant.headers,
          body: new Uint8Array(bytes),
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(`/media-assets/multipart/${upload.id}/parts/1/confirm`))
        .status,
    ).toBe(201);
  });
  afterAll(async () => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const done = once(child, 'exit');
        child.kill('SIGTERM');
        await done;
      }
    if (assetId) {
      const a = await db.mediaAsset.findUniqueOrThrow({
        where: { id: assetId },
        include: { processingJobs: true },
      });
      for (const job of a.processingJobs)
        await (await queue.getJob(job.bullJobId!))?.remove();
      await storage.deleteObjects(
        await storage.listOwnedObjects(a.workspaceId, a.id),
      );
      await db.domainEvent.deleteMany({ where: { aggregateId: a.id } });
      await db.mediaAsset.delete({ where: { id: a.id } });
    }
    await queue.close();
    await db.$disconnect();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it('recovers a stored original after SIGKILL and fences a dead worker before publishing one completed result', async () => {
    const pending = call(`/media-assets/multipart/${upload.id}/complete`).catch(
      () => undefined,
    );
    await signal(api, 'stored-original');
    const before = await db.mediaUpload.findUniqueOrThrow({
      where: { id: upload.id },
    });
    expect(before.status).toBe('FINALIZING');
    expect((await storage.headObject(before.objectKey)).contentLength).toBe(
      bytes.length,
    );
    await kill(api);
    await pending;
    ({ child: api, url } = await start('api'));
    expect(
      (await call(`/media-assets/multipart/${upload.id}/complete`)).status,
    ).toBe(201);
    const first = await start('worker', true);
    await signal(first.child, 'stored-derivative');
    const interrupted = await db.mediaProcessingJob.findUniqueOrThrow({
      where: { uploadId: upload.id },
    });
    expect(interrupted.status).toBe('PROCESSING');
    await kill(first.child);
    await start('worker');
    const until = Date.now() + 100000;
    let ready = false;
    while (Date.now() < until) {
      if (
        (await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId! } }))
          .status === 'READY'
      ) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(ready).toBe(true);
    const job = await db.mediaProcessingJob.findUniqueOrThrow({
      where: { uploadId: upload.id },
    });
    expect(job.executionVersion).toBeGreaterThan(interrupted.executionVersion);
    expect(
      await db.mediaProcessingJob.count({ where: { mediaId: assetId } }),
    ).toBe(1);
    expect(await db.mediaVariant.count({ where: { mediaId: assetId } })).toBe(
      2,
    );
    expect(
      await db.domainEvent.count({
        where: { aggregateId: assetId, type: 'media.processing.completed' },
      }),
    ).toBe(1);
    await storage.downloadToFile(
      before.objectKey,
      join(directory, 'stored.mp4'),
    );
    expect(
      createHash('sha256')
        .update(await readFile(join(directory, 'stored.mp4')))
        .digest('hex'),
    ).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});
