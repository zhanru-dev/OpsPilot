import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
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
    const maxBytes = Number(
      this.config.get('MEDIA_UPLOAD_MAX_BYTES') ?? 100 * 1024 * 1024,
    );
    if (dto.sizeBytes > maxBytes) {
      throw new BadRequestException(
        `Media uploads are limited to ${Math.floor(maxBytes / 1024 / 1024)} MB.`,
      );
    }

    const profile = requireUploadProfile(dto.contentType, dto.kind);
    const mediaId = randomUUID();
    const uploadId = randomUUID();
    const objectKey = `workspaces/${user.workspaceId}/media/${mediaId}/original.${profile.extension}`;
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
    if (upload.status !== MediaUploadStatus.PENDING) {
      throw new ConflictException('This upload has already been completed.');
    }
    if (upload.expiresAt <= new Date()) {
      await this.prisma.mediaUpload.update({
        where: { id: upload.id },
        data: { status: MediaUploadStatus.EXPIRED },
      });
      throw new BadRequestException('The upload intent has expired.');
    }

    let object: Awaited<ReturnType<StorageService['headObject']>>;
    try {
      object = await this.storage.headObject(upload.objectKey);
    } catch {
      throw new BadRequestException(
        'The media object has not been uploaded to storage yet.',
      );
    }
    if (object.contentLength !== upload.expectedSizeBytes) {
      throw new BadRequestException(
        'The uploaded object size does not match the signed upload intent.',
      );
    }
    if (object.contentType?.toLowerCase() !== upload.contentType) {
      throw new BadRequestException(
        'The uploaded object MIME type does not match the signed upload intent.',
      );
    }

    const processingJobId = randomUUID();
    const bullJobId = `media-${processingJobId}`;
    const traceId = this.trace.current() ?? randomUUID();
    await this.prisma.$transaction(async (transaction) => {
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
          processingProgress: 0,
          uploadedAt: new Date(),
          failureReason: null,
        },
      });
      await transaction.mediaProcessingJob.create({
        data: {
          id: processingJobId,
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
          aggregateType: 'MediaAsset',
          aggregateId: upload.mediaId,
          payload: { mediaId: upload.mediaId, processingJobId },
          traceId,
        },
        transaction,
      );
    });

    await this.enqueueProcessing({
      processingJobId,
      mediaId: upload.mediaId,
      workspaceId: user.workspaceId,
      traceId,
    });
    return this.get(upload.mediaId, user);
  }

  async createPlaybackUrl(id: string, user: AuthenticatedUser) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, workspaceId: user.workspaceId, status: MediaStatus.READY },
      include: { variants: true },
    });
    if (!asset) throw new NotFoundException('Ready media was not found.');
    if (asset.previewUrl) {
      return { url: asset.previewUrl, expiresAt: null, source: 'SEEDED' };
    }

    const preview = asset.variants.find(
      (variant) => variant.kind === MediaVariantKind.PREVIEW,
    );
    if (!preview) {
      throw new NotFoundException('A playable media variant was not found.');
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
