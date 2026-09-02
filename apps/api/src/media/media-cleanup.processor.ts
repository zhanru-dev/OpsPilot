import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaStatus, MediaUploadStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import {
  MAINTENANCE_QUEUE,
  MEDIA_CLEANUP_JOB,
} from '../infrastructure/queues/queue.constants';
import { StorageService } from '../infrastructure/storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReadinessService } from '../readiness/readiness.service';

@Injectable()
@Processor(MAINTENANCE_QUEUE, { concurrency: 1 })
export class MediaCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly domainEvents: DomainEventsService,
    private readonly readiness: ReadinessService,
  ) {
    super();
  }

  async process(job: Job) {
    if (job.name !== MEDIA_CLEANUP_JOB) return;

    const expiredUploads = await this.expirePendingUploads();
    const expiredMedia = await this.expireRetainedDemoMedia();
    this.logger.log(
      JSON.stringify({
        event: 'media.cleanup.completed',
        expiredUploads,
        expiredMedia,
      }),
    );
    return { expiredUploads, expiredMedia };
  }

  private async expirePendingUploads() {
    const uploads = await this.prisma.mediaUpload.findMany({
      where: {
        status: MediaUploadStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      include: { media: true },
      take: 100,
    });

    let cleaned = 0;
    for (const upload of uploads) {
      try {
        await this.storage.deleteObjects([upload.objectKey]);
        await this.prisma.$transaction(async (transaction) => {
          await transaction.mediaUpload.update({
            where: { id: upload.id },
            data: { status: MediaUploadStatus.EXPIRED },
          });
          await transaction.mediaAsset.updateMany({
            where: {
              id: upload.mediaId,
              status: {
                in: [MediaStatus.PENDING_UPLOAD, MediaStatus.UPLOADING],
              },
            },
            data: {
              status: MediaStatus.DELETED,
              failureReason: 'The direct upload window expired.',
            },
          });
          await this.audit.record(
            {
              workspaceId: upload.workspaceId,
              action: 'media.upload_expired',
              entityType: 'MediaAsset',
              entityId: upload.mediaId,
              summary: `Expired the upload window for ${upload.media.name}.`,
              changes: { uploadId: upload.id },
            },
            transaction,
          );
          await this.domainEvents.record(
            {
              workspaceId: upload.workspaceId,
              type: 'media.upload.expired',
              aggregateType: 'MediaAsset',
              aggregateId: upload.mediaId,
              payload: { mediaId: upload.mediaId, uploadId: upload.id },
            },
            transaction,
          );
        });
        await this.refreshAttachedEvents(upload.mediaId, upload.workspaceId);
        cleaned += 1;
      } catch (error) {
        this.logFailure('media.upload.cleanup_failed', upload.mediaId, error);
      }
    }
    return cleaned;
  }

  private async expireRetainedDemoMedia() {
    const retentionHours = Number(
      this.config.get('MEDIA_DEMO_RETENTION_HOURS') ?? 24,
    );
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1_000);
    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        isSeeded: false,
        status: { in: [MediaStatus.READY, MediaStatus.FAILED] },
        createdAt: { lte: cutoff },
      },
      include: { uploads: true, variants: true },
      take: 100,
    });

    let cleaned = 0;
    for (const asset of assets) {
      try {
        await this.storage.deleteObjects([
          ...(asset.originalObjectKey ? [asset.originalObjectKey] : []),
          ...asset.variants.map((variant) => variant.objectKey),
        ]);
        await this.prisma.$transaction(async (transaction) => {
          await transaction.mediaVariant.deleteMany({
            where: { mediaId: asset.id },
          });
          await transaction.mediaUpload.updateMany({
            where: { mediaId: asset.id },
            data: { status: MediaUploadStatus.CANCELLED },
          });
          await transaction.mediaAsset.update({
            where: { id: asset.id },
            data: {
              status: MediaStatus.DELETED,
              processingProgress: 0,
              originalObjectKey: null,
              failureReason: 'Expired by the demo media retention policy.',
            },
          });
          await this.audit.record(
            {
              workspaceId: asset.workspaceId,
              action: 'media.retention_expired',
              entityType: 'MediaAsset',
              entityId: asset.id,
              summary: `Expired ${asset.name} under the demo retention policy.`,
              changes: { retentionHours },
            },
            transaction,
          );
          await this.domainEvents.record(
            {
              workspaceId: asset.workspaceId,
              type: 'media.retention.expired',
              aggregateType: 'MediaAsset',
              aggregateId: asset.id,
              payload: { mediaId: asset.id, retentionHours },
            },
            transaction,
          );
        });
        await this.refreshAttachedEvents(asset.id, asset.workspaceId);
        cleaned += 1;
      } catch (error) {
        this.logFailure('media.retention.cleanup_failed', asset.id, error);
      }
    }
    return cleaned;
  }

  private async refreshAttachedEvents(mediaId: string, workspaceId: string) {
    const attachments = await this.prisma.eventMediaAsset.findMany({
      where: { mediaId, event: { workspaceId } },
      select: { eventId: true },
    });
    await Promise.all(
      attachments.map(({ eventId }) =>
        this.readiness.assessAndPersist(eventId, workspaceId),
      ),
    );
  }

  private logFailure(event: string, mediaId: string, error: unknown) {
    this.logger.error(
      JSON.stringify({
        event,
        mediaId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
  }
}
