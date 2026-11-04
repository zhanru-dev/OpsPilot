import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  MediaKind,
  MediaProcessingJobStatus,
  MediaStatus,
  MediaUploadStatus,
  MediaVariantKind,
} from '@prisma/client';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { assertEventNotArchived } from '../common/event-mutations';
import type { AuthenticatedUser } from '../common/request-context';
import { RequestTraceService } from '../common/request-trace.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import {
  MEDIA_PROCESSING_QUEUE,
  MEDIA_PROCESS_JOB,
} from '../infrastructure/queues/queue.constants';
import { StorageService } from '../infrastructure/storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReadinessService } from '../readiness/readiness.service';
import type { CreateMediaUploadDto } from './dto/create-media-upload.dto';
import type { MediaProcessingJobData } from './media-processing.types';
import { mediaAuthority } from './media-authority';
import { requireUploadProfile, safeMediaName } from './media-validation';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessService,
    private readonly audit: AuditService,
    private readonly domainEvents: DomainEventsService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly trace: RequestTraceService,
    @InjectQueue(MEDIA_PROCESSING_QUEUE)
    private readonly processingQueue: Queue<MediaProcessingJobData>,
  ) {}

  list(
    user: AuthenticatedUser,
    filters: { status?: MediaStatus; kind?: MediaKind; search?: string },
  ) {
    return this.prisma.mediaAsset
      .findMany({
        where: {
          workspaceId: user.workspaceId,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.kind ? { kind: filters.kind } : {}),
          ...(filters.search
            ? {
                name: {
                  contains: filters.search,
                  mode: 'insensitive' as const,
                },
              }
            : {}),
        },
        include: {
          events: { include: { event: { select: { id: true, title: true } } } },
          processingJobs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { attempts: { orderBy: { attemptNumber: 'desc' } } },
          },
          variants: true,
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      })
      .then((items) => ({ items }));
  }

  async get(id: string, user: AuthenticatedUser) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, workspaceId: user.workspaceId },
      include: {
        events: { include: { event: true } },
        uploads: { orderBy: { createdAt: 'desc' }, take: 3 },
        processingJobs: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
        },
        variants: true,
      },
    });
    if (!asset) throw new NotFoundException('Media asset was not found.');
    return asset;
  }

  async createUploadIntent(dto: CreateMediaUploadDto, user: AuthenticatedUser) {
    const maxBytes = Math.min(
      104857600,
      Number(this.config.get('MEDIA_UPLOAD_MAX_BYTES') ?? 104857600),
    );
    if (dto.sizeBytes > maxBytes) {
      throw new BadRequestException(
        `Media uploads are limited to ${Math.floor(maxBytes / 1024 / 1024)} MB.`,
      );
    }

    const profile = requireUploadProfile(dto.contentType, dto.kind);
    const mediaId = randomUUID();
    const uploadId = randomUUID();
    const objectKey = `workspaces/${user.workspaceId}/media/${mediaId}/uploads/${uploadId}/source.${profile.extension}`;
    const ttlSeconds = Number(
      this.config.get('MEDIA_UPLOAD_URL_TTL_SECONDS') ?? 600,
    );
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const uploadUrl = await this.storage.createUploadUrl(
      objectKey,
      profile.contentType,
      dto.sizeBytes,
      ttlSeconds,
    );

    await this.prisma.$transaction(async (transaction) => {
      await mediaAuthority(transaction, user, true);
      await transaction.mediaAsset.create({
        data: {
          id: mediaId,
          workspaceId: user.workspaceId,
          name: safeMediaName(dto.name),
          kind: dto.kind,
          status: MediaStatus.UPLOADING,
          description: dto.description?.trim() || null,
          sizeBytes: dto.sizeBytes,
          sourceContentType: profile.contentType,
          originalObjectKey: objectKey,
        },
      });
      await transaction.mediaUpload.create({
        data: {
          id: uploadId,
          ownerUserId: user.id,
          mediaId,
          workspaceId: user.workspaceId,
          objectKey,
          contentType: profile.contentType,
          expectedSizeBytes: dto.sizeBytes,
          expiresAt,
        },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'media.upload_intent_created',
          entityType: 'MediaAsset',
          entityId: mediaId,
          summary: `Created a private upload intent for ${safeMediaName(dto.name)}.`,
          changes: {
            uploadId,
            contentType: profile.contentType,
            sizeBytes: dto.sizeBytes,
            expiresAt: expiresAt.toISOString(),
          },
        },
        transaction,
      );
    });

    return {
      assetId: mediaId,
      uploadId,
      uploadUrl,
      expiresAt,
      requiredHeaders: { 'Content-Type': profile.contentType },
    };
  }

  async completeUpload(uploadId: string, user: AuthenticatedUser) {
    const upload = await this.prisma.mediaUpload.findFirst({
      where: { id: uploadId, workspaceId: user.workspaceId },
      include: { media: true },
    });
    if (!upload) throw new NotFoundException('Media upload was not found.');
    if (upload.manifest)
      throw new BadRequestException(
        'Use the multipart completion endpoint for this upload.',
      );
    // Persist the intent separately from storage. A copy that survives a failed
    // DB commit is reused on retry; it must never be replaced from mutable staging.
    const assertOpen = (row: typeof upload | Omit<typeof upload, 'media'>) => {
      if (row.ownerUserId && row.ownerUserId !== user.id)
        throw new ForbiddenException('Only the upload owner can complete it.');
      if (!['PENDING', 'FINALIZING'].includes(row.status))
        throw new ConflictException('This upload has already been completed.');
      if (row.expiresAt <= new Date())
        throw new BadRequestException('The upload intent has expired.');
    };
    const profile = requireUploadProfile(upload.contentType, upload.media.kind);
    const snapshotKey = `workspaces/${user.workspaceId}/media/${upload.mediaId}/originals/${upload.id}/source.${profile.extension}`;
    const validateObject = (
      object: Awaited<ReturnType<StorageService['headObject']>>,
    ) => {
      if (object.contentLength !== upload.expectedSizeBytes)
        throw new BadRequestException(
          'The uploaded object size does not match the signed upload intent.',
        );
      if (object.contentType?.toLowerCase() !== upload.contentType)
        throw new BadRequestException(
          'The uploaded object MIME type does not match the signed upload intent.',
        );
    };
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${upload.mediaId} FOR UPDATE`;
        await mediaAuthority(tx, user, true);
        const current = await tx.mediaUpload.findUniqueOrThrow({
          where: { id: upload.id },
        });
        assertOpen(current);
        if (!current.snapshotSourceEtag) {
          let source: Awaited<ReturnType<StorageService['headObject']>>;
          try {
            source = await this.storage.headObject(upload.objectKey);
          } catch (error) {
            if (
              (error as { $metadata?: { httpStatusCode?: number } }).$metadata
                ?.httpStatusCode !== 404
            )
              throw error;
            throw new BadRequestException(
              'The media object has not been uploaded to storage yet.',
            );
          }
          validateObject(source);
          if (!source.etag)
            throw new ConflictException(
              'Storage did not return a source version.',
            );
          // Every retry, including an uncertain/late CopyObject response, is bound
          // to this same source version. Never choose a different staging ETag.
          await tx.mediaUpload.update({
            where: { id: upload.id },
            data: {
              status: 'FINALIZING',
              finalizingAt: new Date(),
              snapshotSourceEtag: source.etag,
            },
          });
        }
      },
      { timeout: 60000 },
    );
    const processingJobId = randomUUID();
    const bullJobId = `media-${processingJobId}`;
    const traceId = this.trace.current() ?? randomUUID();
    await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${upload.mediaId} FOR UPDATE`;
        await mediaAuthority(transaction, user, true);
        const currentUpload = await transaction.mediaUpload.findUniqueOrThrow({
          where: { id: upload.id },
        });
        assertOpen(currentUpload);
        const currentAsset = await transaction.mediaAsset.findUniqueOrThrow({
          where: { id: upload.mediaId },
        });
        if (currentAsset.status !== 'UPLOADING' || currentAsset.cleanupPending)
          throw new ConflictException('Media cannot be finalized.');
        let frozen: Awaited<ReturnType<StorageService['headObject']>>;
        try {
          frozen = await this.storage.headObject(snapshotKey);
        } catch (error) {
          if (
            (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode !== 404
          )
            throw error;
          try {
            await this.storage.copyObject(
              upload.objectKey,
              snapshotKey,
              currentUpload.snapshotSourceEtag!,
            );
          } catch (error) {
            if (
              (error as { $metadata?: { httpStatusCode?: number } }).$metadata
                ?.httpStatusCode === 412
            )
              throw new ConflictException(
                'The upload changed during completion. Retry completion.',
              );
            throw error;
          }
          frozen = await this.storage.headObject(snapshotKey);
        }
        validateObject(frozen);
        const sha256 = await this.storage.sha256Object(
          snapshotKey,
          upload.expectedSizeBytes,
        );
        await transaction.mediaUpload.update({
          where: { id: upload.id },
          data: {
            status: MediaUploadStatus.UPLOADED,
            completedAt: new Date(),
          },
        });
        await transaction.mediaAsset.update({
          where: { id: upload.mediaId },
          data: {
            status: MediaStatus.PROCESSING,
            originalObjectKey: snapshotKey,
            sourceSha256: sha256,
            processingProgress: 0,
            uploadedAt: new Date(),
            failureReason: null,
          },
        });
        await transaction.mediaProcessingJob.create({
          data: {
            id: processingJobId,
            uploadId: upload.id,
            mediaId: upload.mediaId,
            bullJobId,
            traceId,
          },
        });
        await this.audit.record(
          {
            workspaceId: user.workspaceId,
            actorId: user.id,
            action: 'media.processing_queued',
            entityType: 'MediaAsset',
            entityId: upload.mediaId,
            summary: `Queued ${upload.media.name} for media processing.`,
            changes: { processingJobId, uploadId: upload.id },
          },
          transaction,
        );
        await this.domainEvents.record(
          {
            workspaceId: user.workspaceId,
            type: 'media.processing.queued',
            idempotencyKey: `media:${processingJobId}:queued`,
            aggregateType: 'MediaAsset',
            aggregateId: upload.mediaId,
            payload: { mediaId: upload.mediaId, processingJobId },
            traceId,
          },
          transaction,
        );
      },
      { timeout: 120000 },
    );

    await this.enqueueProcessing({
      processingJobId,
      mediaId: upload.mediaId,
      workspaceId: user.workspaceId,
      traceId,
    });
    return this.get(upload.mediaId, user);
  }

  async createPlaybackUrl(
    id: string,
    user: AuthenticatedUser,
    kind: MediaVariantKind = MediaVariantKind.PREVIEW,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${id} FOR SHARE`;
        await mediaAuthority(tx, user);
        const asset = await tx.mediaAsset.findFirst({
          where: {
            id,
            workspaceId: user.workspaceId,
            status: MediaStatus.READY,
          },
          include: { variants: true },
        });
        if (!asset) throw new NotFoundException('Ready media was not found.');
        if (asset.previewUrl && kind === MediaVariantKind.PREVIEW) {
          return { url: asset.previewUrl, expiresAt: null, source: 'SEEDED' };
        }

        const preview = asset.variants.find((variant) => variant.kind === kind);
        if (!preview) {
          throw new NotFoundException(
            'A playable media variant was not found.',
          );
        }
        try {
          await this.storage.headObject(preview.objectKey);
        } catch {
          throw new ServiceUnavailableException(
            'Stored preview is unavailable. Retry later or reprocess the source.',
          );
        }
        const ttlSeconds = Number(
          this.config.get('MEDIA_PLAYBACK_URL_TTL_SECONDS') ?? 300,
        );
        return {
          url: await this.storage.createPlaybackUrl(
            preview.objectKey,
            preview.contentType,
            ttlSeconds,
          ),
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
          source: 'PRIVATE_STORAGE',
        };
      },
      { timeout: 20000 },
    );
  }

  async retryProcessing(id: string, user: AuthenticatedUser) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id,
        workspaceId: user.workspaceId,
        isSeeded: false,
        status: MediaStatus.FAILED,
        originalObjectKey: { not: null },
      },
    });
    if (!asset) {
      throw new NotFoundException('Failed uploaded media was not found.');
    }
    const activeJob = await this.prisma.mediaProcessingJob.findFirst({
      where: {
        mediaId: id,
        status: {
          in: [
            MediaProcessingJobStatus.QUEUED,
            MediaProcessingJobStatus.PROCESSING,
          ],
        },
      },
    });
    if (activeJob) {
      throw new ConflictException('Media processing is already active.');
    }

    const processingJobId = randomUUID();
    const bullJobId = `media-${processingJobId}`;
    const traceId = this.trace.current() ?? randomUUID();
    await this.prisma.$transaction(async (transaction) => {
      await mediaAuthority(transaction, user, true);
      await transaction.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${id} FOR UPDATE`;
      const currentAsset = await transaction.mediaAsset.findUniqueOrThrow({
        where: { id },
      });
      if (currentAsset.status !== 'FAILED' || currentAsset.cleanupPending)
        throw new ConflictException('Media is no longer eligible for retry.');
      await transaction.mediaAsset.update({
        where: { id },
        data: {
          status: MediaStatus.PROCESSING,
          processingProgress: 0,
          failureReason: null,
        },
      });
      await transaction.mediaProcessingJob.create({
        data: {
          id: processingJobId,
          mediaId: id,
          bullJobId,
          traceId,
        },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'media.processing_retried',
          entityType: 'MediaAsset',
          entityId: id,
          summary: `Queued a new processing run for ${asset.name}.`,
          changes: { processingJobId },
        },
        transaction,
      );
    });

    await this.enqueueProcessing({
      processingJobId,
      mediaId: id,
      workspaceId: user.workspaceId,
      traceId,
    });
    return this.get(id, user);
  }

  async retry(id: string, user: AuthenticatedUser) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id,
        workspaceId: user.workspaceId,
        isSeeded: true,
        status: MediaStatus.FAILED,
      },
    });
    if (!asset) throw new NotFoundException('Failed demo media was not found.');
    const updated = await this.prisma.$transaction(async (transaction) => {
      await mediaAuthority(transaction, user, true);
      const changed = await transaction.mediaAsset.update({
        where: { id },
        data: {
          status: MediaStatus.READY,
          failureReason: null,
          previewUrl:
            asset.kind === MediaKind.VIDEO
              ? 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
              : asset.previewUrl,
        },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'media.demo_retry_completed',
          entityType: 'MediaAsset',
          entityId: id,
          summary: `Completed the transparent v1.0 demo retry for ${asset.name}.`,
          changes: {
            from: asset.status,
            to: MediaStatus.READY,
            adapter: 'demo',
          },
        },
        transaction,
      );
      return changed;
    });
    return { asset: updated, processingAdapter: 'DEMO' };
  }

  async attach(mediaId: string, eventId: string, user: AuthenticatedUser) {
    const [asset, event, existing] = await Promise.all([
      this.prisma.mediaAsset.findFirst({
        where: { id: mediaId, workspaceId: user.workspaceId },
      }),
      this.prisma.streamEvent.findFirst({
        where: { id: eventId, workspaceId: user.workspaceId },
      }),
      this.prisma.eventMediaAsset.findUnique({
        where: { eventId_mediaId: { eventId, mediaId } },
      }),
    ]);
    if (!asset) throw new NotFoundException('Media asset was not found.');
    if (!event) throw new NotFoundException('Stream event was not found.');
    assertEventNotArchived(event.status);
    if (asset.status !== MediaStatus.READY) {
      throw new NotFoundException(
        'Only ready media can be attached to an event.',
      );
    }
    if (!existing) {
      await this.prisma.$transaction(async (transaction) => {
        await mediaAuthority(transaction, user, true);
        await transaction.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${mediaId} FOR UPDATE`;
        const currentAsset = await transaction.mediaAsset.findUniqueOrThrow({
          where: { id: mediaId },
        });
        if (currentAsset.status !== 'READY' || currentAsset.cleanupPending)
          throw new ConflictException('Media is no longer available.');
        await transaction.eventMediaAsset.create({
          data: { eventId, mediaId, purpose: 'supporting-content' },
        });
        await this.audit.record(
          {
            workspaceId: user.workspaceId,
            eventId,
            actorId: user.id,
            action: 'media.attached',
            entityType: 'MediaAsset',
            entityId: mediaId,
            summary: `Attached ${asset.name} to ${event.title}.`,
          },
          transaction,
        );
      });
    }
    return {
      attached: !existing,
      readiness: await this.readiness.assessAndPersist(
        eventId,
        user.workspaceId,
      ),
    };
  }

  async detach(mediaId: string, eventId: string, user: AuthenticatedUser) {
    const attachment = await this.prisma.eventMediaAsset.findFirst({
      where: {
        mediaId,
        eventId,
        event: { workspaceId: user.workspaceId },
        media: { workspaceId: user.workspaceId },
      },
      include: { event: true, media: true },
    });
    if (!attachment) {
      throw new NotFoundException('Media attachment was not found.');
    }
    assertEventNotArchived(attachment.event.status);
    await this.prisma.$transaction(async (transaction) => {
      await mediaAuthority(transaction, user, true);
      await transaction.eventMediaAsset.delete({
        where: { eventId_mediaId: { eventId, mediaId } },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId,
          actorId: user.id,
          action: 'media.detached',
          entityType: 'MediaAsset',
          entityId: mediaId,
          summary: `Detached ${attachment.media.name} from ${attachment.event.title}.`,
        },
        transaction,
      );
    });
    return {
      readiness: await this.readiness.assessAndPersist(
        eventId,
        user.workspaceId,
      ),
    };
  }

  async registerUploaded(
    tx: Prisma.TransactionClient,
    uploadId: string,
    mediaId: string,
    user: AuthenticatedUser,
    sha256: string,
  ) {
    await mediaAuthority(tx, user, true);
    const asset = await tx.mediaAsset.findUniqueOrThrow({
      where: { id: mediaId },
    });
    if (asset.status !== 'UPLOADING' || asset.cleanupPending)
      throw new ConflictException('Media cannot be finalized.');
    const processingJobId = randomUUID();
    const traceId = this.trace.current() ?? randomUUID();
    await tx.mediaUpload.update({
      where: { id: uploadId },
      data: { status: 'UPLOADED', completedAt: new Date() },
    });
    await tx.mediaAsset.update({
      where: { id: mediaId },
      data: {
        status: 'PROCESSING',
        sourceSha256: sha256,
        uploadedAt: new Date(),
        processingProgress: 0,
        failureReason: null,
      },
    });
    await tx.mediaProcessingJob.create({
      data: {
        id: processingJobId,
        uploadId,
        mediaId,
        bullJobId: `media-${processingJobId}`,
        traceId,
      },
    });
    await this.domainEvents.record(
      {
        workspaceId: user.workspaceId,
        type: 'media.processing.queued',
        idempotencyKey: `media:${processingJobId}:queued`,
        aggregateType: 'MediaAsset',
        aggregateId: mediaId,
        payload: { mediaId, uploadId, processingJobId },
        traceId,
      },
      tx,
    );
    await this.audit.record(
      {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'media.multipart_completed',
        entityType: 'MediaAsset',
        entityId: mediaId,
        summary: 'Verified stored original and queued media processing.',
        changes: { uploadId, processingJobId },
      },
      tx,
    );
  }

  async enqueueUpload(uploadId: string) {
    const job = await this.prisma.mediaProcessingJob.findUniqueOrThrow({
      where: { uploadId },
      include: { media: true },
    });
    if (job.status === 'QUEUED')
      await this.enqueueProcessing({
        processingJobId: job.id,
        mediaId: job.mediaId,
        workspaceId: job.media.workspaceId,
        traceId: job.traceId,
      });
  }

  async deleteAsset(id: string, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${id} FOR UPDATE`;
      await mediaAuthority(tx, user, true);
      const asset = await tx.mediaAsset.findFirst({
        where: { id, workspaceId: user.workspaceId },
        include: { uploads: true },
      });
      if (!asset) throw new NotFoundException('Media asset was not found.');
      if (asset.status === 'DELETED')
        return { deleted: true, cleanupPending: asset.cleanupPending };
      if (await tx.eventMediaAsset.count({ where: { mediaId: id } }))
        throw new ConflictException(
          'Detach this asset from its events before deleting it.',
        );
      if (['PROCESSING', 'UPLOADING', 'PENDING_UPLOAD'].includes(asset.status))
        throw new ConflictException(
          'Wait for processing to finish, or cancel the active upload first.',
        );
      const cleanupAfter = new Date(
        Math.max(
          Date.now(),
          ...asset.uploads.map((u) =>
            Math.max(
              u.lastGrantExpiresAt?.getTime() ?? 0,
              u.manifest ? 0 : u.expiresAt.getTime(),
            ),
          ),
        ),
      );
      await tx.mediaAsset.update({
        where: { id },
        data: {
          status: 'DELETED',
          cleanupPending: true,
          cleanupAfter,
          processingProgress: 0,
        },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'media.deleted',
          entityType: 'MediaAsset',
          entityId: id,
          summary:
            'Deleted an unreferenced media asset; storage cleanup is scheduled.',
        },
        tx,
      );
      return { deleted: true, cleanupPending: true };
    });
  }

  private async enqueueProcessing(data: MediaProcessingJobData) {
    const record = await this.prisma.mediaProcessingJob.findUniqueOrThrow({
      where: { id: data.processingJobId },
    });
    try {
      await this.processingQueue.add(MEDIA_PROCESS_JOB, data, {
        jobId: record.bullJobId ?? undefined,
        attempts: record.maxAttempts,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      });
    } catch {
      throw new ServiceUnavailableException(
        'Media processing is queued but the worker broker is temporarily unavailable.',
      );
    }
  }
}
