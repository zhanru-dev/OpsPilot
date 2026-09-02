import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MediaKind,
  MediaProcessingAttemptStatus,
  MediaProcessingJobStatus,
  MediaStatus,
  MediaVariantKind,
} from '@prisma/client';
import type { Job } from 'bullmq';
import ffmpegPath from 'ffmpeg-static';
import { path as ffprobePath } from 'ffprobe-static';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { AuditService } from '../audit/audit.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import {
  MEDIA_PROCESSING_QUEUE,
  MEDIA_PROCESS_JOB,
} from '../infrastructure/queues/queue.constants';
import { StorageService } from '../infrastructure/storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReadinessService } from '../readiness/readiness.service';
import { runCommand } from './command-runner';
import type {
  MediaProcessingJobData,
  ProbedMedia,
} from './media-processing.types';
import { assertProbedMedia } from './media-validation';

type MediaMetadata = {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  videoCodec?: string;
  audioCodec?: string;
};

type VariantOutput = {
  kind: MediaVariantKind;
  path: string;
  objectKey: string;
  contentType: string;
  width?: number;
  height?: number;
};

@Injectable()
@Processor(MEDIA_PROCESSING_QUEUE, { concurrency: 2 })
export class MediaProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessingProcessor.name);

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

  async process(job: Job<MediaProcessingJobData>) {
    if (job.name !== MEDIA_PROCESS_JOB) return;

    const record = await this.prisma.mediaProcessingJob.findUnique({
      where: { id: job.data.processingJobId },
      include: { media: true },
    });
    if (!record)
      throw new Error('MEDIA_JOB_NOT_FOUND: Processing record does not exist.');
    if (record.status === MediaProcessingJobStatus.SUCCEEDED) {
      return { mediaId: record.mediaId, idempotent: true };
    }
    if (!record.media.originalObjectKey) {
      throw new Error(
        'MEDIA_OBJECT_MISSING: Original object key is not recorded.',
      );
    }

    const attemptNumber = job.attemptsMade + 1;
    const attempt = await this.prisma.mediaProcessingAttempt.upsert({
      where: {
        processingJobId_attemptNumber: {
          processingJobId: record.id,
          attemptNumber,
        },
      },
      update: {
        status: MediaProcessingAttemptStatus.PROCESSING,
        failureCode: null,
        failureReason: null,
        startedAt: new Date(),
        finishedAt: null,
      },
      create: {
        processingJobId: record.id,
        attemptNumber,
      },
    });
    await this.prisma.$transaction([
      this.prisma.mediaProcessingJob.update({
        where: { id: record.id },
        data: {
          status: MediaProcessingJobStatus.PROCESSING,
          attemptCount: attemptNumber,
          progress: 5,
          startedAt: record.startedAt ?? new Date(),
          failureCode: null,
          failureReason: null,
        },
      }),
      this.prisma.mediaAsset.update({
        where: { id: record.mediaId },
        data: { status: MediaStatus.PROCESSING, processingProgress: 5 },
      }),
    ]);

    const directory = await mkdtemp(join(tmpdir(), 'opspilot-media-'));
    const source = join(
      directory,
      `original${extname(record.media.originalObjectKey)}`,
    );

    try {
      await this.storage.downloadToFile(record.media.originalObjectKey, source);
      await this.updateProgress(job, record.id, record.mediaId, 20);
      const metadata = await this.probe(source);
      assertProbedMedia(
        metadata,
        record.media.kind,
        Number(this.config.get('MEDIA_MAX_DURATION_SECONDS') ?? 300),
      );
      await this.updateProgress(job, record.id, record.mediaId, 35);

      const outputs = await this.transcode(
        source,
        directory,
        record.media.kind,
        job.data.workspaceId,
        record.mediaId,
      );
      await this.updateProgress(job, record.id, record.mediaId, 75);

      const uploaded = [] as Array<VariantOutput & { sizeBytes: number }>;
      for (const output of outputs) {
        const sizeBytes = await this.storage.uploadFile(
          output.objectKey,
          output.path,
          output.contentType,
        );
        uploaded.push({ ...output, sizeBytes });
      }
      await this.updateProgress(job, record.id, record.mediaId, 90);

      await this.prisma.$transaction(async (transaction) => {
        for (const output of uploaded) {
          await transaction.mediaVariant.upsert({
            where: {
              mediaId_kind_profileVersion: {
                mediaId: record.mediaId,
                kind: output.kind,
                profileVersion: record.profileVersion,
              },
            },
            update: {
              objectKey: output.objectKey,
              contentType: output.contentType,
              sizeBytes: output.sizeBytes,
              durationSeconds:
                output.kind === MediaVariantKind.PREVIEW
                  ? metadata.durationSeconds
                  : null,
              width: output.width ?? null,
              height: output.height ?? null,
            },
            create: {
              mediaId: record.mediaId,
              kind: output.kind,
              profileVersion: record.profileVersion,
              objectKey: output.objectKey,
              contentType: output.contentType,
              sizeBytes: output.sizeBytes,
              durationSeconds:
                output.kind === MediaVariantKind.PREVIEW
                  ? metadata.durationSeconds
                  : null,
              width: output.width,
              height: output.height,
            },
          });
        }
        await transaction.mediaAsset.update({
          where: { id: record.mediaId },
          data: {
            status: MediaStatus.READY,
            processingProgress: 100,
            durationSeconds: metadata.durationSeconds,
            width: metadata.width,
            height: metadata.height,
            processedAt: new Date(),
            failureReason: null,
          },
        });
        await transaction.mediaProcessingJob.update({
          where: { id: record.id },
          data: {
            status: MediaProcessingJobStatus.SUCCEEDED,
            progress: 100,
            finishedAt: new Date(),
            failureCode: null,
            failureReason: null,
          },
        });
        await transaction.mediaProcessingAttempt.update({
          where: { id: attempt.id },
          data: {
            status: MediaProcessingAttemptStatus.SUCCEEDED,
            finishedAt: new Date(),
          },
        });
        await this.audit.record(
          {
            workspaceId: job.data.workspaceId,
            action: 'media.processing_completed',
            entityType: 'MediaAsset',
            entityId: record.mediaId,
            summary: `Completed real media processing for ${record.media.name}.`,
            changes: {
              processingJobId: record.id,
              attemptNumber,
              durationSeconds: metadata.durationSeconds,
              variants: uploaded.map((output) => output.kind),
              profileVersion: record.profileVersion,
            },
            traceId: job.data.traceId,
          },
          transaction,
        );
        await this.domainEvents.record(
          {
            workspaceId: job.data.workspaceId,
            type: 'media.processing.completed',
            aggregateType: 'MediaAsset',
            aggregateId: record.mediaId,
            payload: {
              mediaId: record.mediaId,
              processingJobId: record.id,
              attemptNumber,
            },
            traceId: job.data.traceId,
          },
          transaction,
        );
      });

      await this.refreshAttachedEvents(record.mediaId, job.data.workspaceId);
      this.logger.log(
        JSON.stringify({
          event: 'media.processing.completed',
          mediaId: record.mediaId,
          processingJobId: record.id,
          attemptNumber,
          traceId: job.data.traceId,
        }),
      );
      return { mediaId: record.mediaId, processingJobId: record.id };
    } catch (error) {
      await this.recordFailure(job, record, attempt.id, attemptNumber, error);
      throw error;
    } finally {
      if (directory.startsWith(tmpdir())) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }

  private async probe(source: string): Promise<MediaMetadata> {
    const result = await runCommand(ffprobePath, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      source,
    ]);
    const probe = JSON.parse(result.stdout) as ProbedMedia;
    const video = probe.streams?.find(
      (stream) => stream.codec_type === 'video',
    );
    const audio = probe.streams?.find(
      (stream) => stream.codec_type === 'audio',
    );
    const duration = Number(
      probe.format?.duration ?? video?.duration ?? audio?.duration,
    );
    return {
      durationSeconds: Math.max(1, Math.ceil(duration)),
      width: video?.width ?? null,
      height: video?.height ?? null,
      videoCodec: video?.codec_name,
      audioCodec: audio?.codec_name,
    };
  }

  private async transcode(
    source: string,
    directory: string,
    kind: MediaKind,
    workspaceId: string,
    mediaId: string,
  ): Promise<VariantOutput[]> {
    if (!ffmpegPath)
      throw new Error('FFMPEG_UNAVAILABLE: FFmpeg is not installed.');
    const root = `workspaces/${workspaceId}/media/${mediaId}/variants/v1`;
    if (kind === MediaKind.AUDIO) {
      const preview = join(directory, 'preview.mp3');
      await runCommand(ffmpegPath, [
        '-y',
        '-i',
        source,
        '-vn',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        preview,
      ]);
      return [
        {
          kind: MediaVariantKind.PREVIEW,
          path: preview,
          objectKey: `${root}/preview.mp3`,
          contentType: 'audio/mpeg',
        },
      ];
    }

    const preview = join(directory, 'preview.mp4');
    const thumbnail = join(directory, 'thumbnail.jpg');
    await runCommand(ffmpegPath, [
      '-y',
      '-i',
      source,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      'scale=1280:-2:force_original_aspect_ratio=decrease',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      preview,
    ]);
    await runCommand(ffmpegPath, [
      '-y',
      '-i',
      source,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2:force_original_aspect_ratio=decrease',
      thumbnail,
    ]);
    const thumbnailFile = await stat(thumbnail);
    if (!thumbnailFile.size) {
      throw new Error(
        'MEDIA_THUMBNAIL_EMPTY: FFmpeg produced an empty thumbnail.',
      );
    }
    return [
      {
        kind: MediaVariantKind.PREVIEW,
        path: preview,
        objectKey: `${root}/preview.mp4`,
        contentType: 'video/mp4',
      },
      {
        kind: MediaVariantKind.THUMBNAIL,
        path: thumbnail,
        objectKey: `${root}/thumbnail.jpg`,
        contentType: 'image/jpeg',
        width: 640,
      },
    ];
  }

  private async updateProgress(
    job: Job<MediaProcessingJobData>,
    processingJobId: string,
    mediaId: string,
    progress: number,
  ) {
    await job.updateProgress(progress);
    await this.prisma.$transaction([
      this.prisma.mediaProcessingJob.update({
        where: { id: processingJobId },
        data: { progress },
      }),
      this.prisma.mediaAsset.update({
        where: { id: mediaId },
        data: { processingProgress: progress },
      }),
    ]);
  }

  private async recordFailure(
    job: Job<MediaProcessingJobData>,
    record: {
      id: string;
      mediaId: string;
      maxAttempts: number;
      media: { name: string };
    },
    attemptId: string,
    attemptNumber: number,
    error: unknown,
  ) {
    const message =
      error instanceof Error ? error.message : 'Unknown processing failure.';
    const [failureCode] = message.split(':', 1);
    const maxAttempts = job.opts.attempts ?? record.maxAttempts;
    const finalAttempt = attemptNumber >= maxAttempts;
    const safeMessage = message.slice(0, 1_000);

    await this.prisma.$transaction(async (transaction) => {
      await transaction.mediaProcessingAttempt.update({
        where: { id: attemptId },
        data: {
          status: MediaProcessingAttemptStatus.FAILED,
          failureCode,
          failureReason: safeMessage,
          finishedAt: new Date(),
        },
      });
      await transaction.mediaProcessingJob.update({
        where: { id: record.id },
        data: {
          status: finalAttempt
            ? MediaProcessingJobStatus.FAILED
            : MediaProcessingJobStatus.QUEUED,
          failureCode,
          failureReason: safeMessage,
          finishedAt: finalAttempt ? new Date() : null,
        },
      });
      if (finalAttempt) {
        await transaction.mediaAsset.update({
          where: { id: record.mediaId },
          data: {
            status: MediaStatus.FAILED,
            processingProgress: 0,
            failureReason: safeMessage,
          },
        });
        await this.audit.record(
          {
            workspaceId: job.data.workspaceId,
            action: 'media.processing_failed',
            entityType: 'MediaAsset',
            entityId: record.mediaId,
            summary: `Media processing failed for ${record.media.name}.`,
            changes: {
              processingJobId: record.id,
              attemptNumber,
              failureCode,
            },
            traceId: job.data.traceId,
          },
          transaction,
        );
        await this.domainEvents.record(
          {
            workspaceId: job.data.workspaceId,
            type: 'media.processing.failed',
            aggregateType: 'MediaAsset',
            aggregateId: record.mediaId,
            payload: {
              mediaId: record.mediaId,
              processingJobId: record.id,
              attemptNumber,
              failureCode,
            },
            traceId: job.data.traceId,
          },
          transaction,
        );
      }
    });
    this.logger.warn(
      JSON.stringify({
        event: 'media.processing.failed',
        mediaId: record.mediaId,
        processingJobId: record.id,
        attemptNumber,
        finalAttempt,
        failureCode,
        traceId: job.data.traceId,
      }),
    );
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
}
