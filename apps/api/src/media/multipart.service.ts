import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { UploadManifest, UploadReceipt } from '@opspilot/media-contracts';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { MediaService } from './media.service';
import { mediaAuthority } from './media-authority';
import { requireUploadProfile, safeMediaName } from './media-validation';
import type { MultipartUploadDto } from './dto/multipart-upload.dto';

export const PART_BYTES = 5 * 1024 * 1024;
const include = { media: true, parts: { orderBy: { number: 'asc' as const } } };
type Row = Prisma.MediaUploadGetPayload<{ include: typeof include }>;
const manifest = (row: Row) => row.manifest as unknown as UploadManifest;
const partSize = (size: number, number: number) =>
  Math.min(PART_BYTES, size - (number - 1) * PART_BYTES);

@Injectable()
export class MultipartService {
  constructor(
    private readonly db: PrismaService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async init(input: MultipartUploadDto, user: AuthenticatedUser) {
    const limit = Math.min(
      Number(this.config.get('MEDIA_UPLOAD_MAX_BYTES') ?? 104857600),
      104857600,
    );
    if (
      input.sizeBytes > limit ||
      input.hashes.length !== Math.ceil(input.sizeBytes / PART_BYTES)
    )
      throw new BadRequestException(
        'File size or part manifest is invalid. Maximum file size is 100 MiB.',
      );
    const profile = requireUploadProfile(input.contentType, input.kind);
    const data: UploadManifest = {
      clientOperationId: input.clientOperationId,
      name: safeMediaName(input.name),
      kind: input.kind,
      contentType: profile.contentType,
      sizeBytes: input.sizeBytes,
      hashes: input.hashes,
      ...(input.description ? { description: input.description.trim() } : {}),
    };
    const id = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${user.workspaceId} FOR UPDATE`;
      await mediaAuthority(tx, user, true);
      const old = await tx.mediaUpload.findUnique({
        where: {
          workspaceId_ownerUserId_clientOperationId: {
            workspaceId: user.workspaceId,
            ownerUserId: user.id,
            clientOperationId: data.clientOperationId,
          },
        },
      });
      if (old) {
        const oldData = old.manifest as unknown as UploadManifest;
        if (
          oldData.name !== data.name ||
          oldData.kind !== data.kind ||
          oldData.sizeBytes !== data.sizeBytes ||
          oldData.contentType !== data.contentType ||
          oldData.description !== data.description ||
          JSON.stringify(oldData.hashes) !== JSON.stringify(data.hashes)
        )
          throw new ConflictException(
            'Upload operation already identifies different content.',
          );
        return old.id;
      }
      const open = {
        workspaceId: user.workspaceId,
        status: {
          in: ['PENDING', 'FINALIZING'] as ('PENDING' | 'FINALIZING')[],
        },
      };
      if (
        (await tx.mediaUpload.count({
          where: { ...open, ownerUserId: user.id },
        })) >= 12 ||
        (await tx.mediaUpload.count({ where: open })) >= 64
      )
        throw new ConflictException(
          'Too many unfinished uploads. Finish or cancel existing uploads first.',
        );
      const assetId = randomUUID();
      const uploadId = randomUUID();
      const objectKey = `workspaces/${user.workspaceId}/media/${assetId}/original.${profile.extension}`;
      await tx.mediaAsset.create({
        data: {
          id: assetId,
          workspaceId: user.workspaceId,
          name: data.name,
          description: data.description,
          kind: input.kind,
          status: 'UPLOADING',
          sizeBytes: data.sizeBytes,
          sourceContentType: data.contentType,
          originalObjectKey: objectKey,
        },
      });
      await tx.mediaUpload.create({
        data: {
          id: uploadId,
          mediaId: assetId,
          workspaceId: user.workspaceId,
          ownerUserId: user.id,
          clientOperationId: data.clientOperationId,
          manifest: data,
          contentType: data.contentType,
          expectedSizeBytes: data.sizeBytes,
          objectKey,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'media.multipart_initialized',
          entityType: 'MediaAsset',
          entityId: assetId,
          summary: 'Reserved a resumable media upload.',
          changes: { uploadId },
        },
        tx,
      );
      return uploadId;
    });
    return this.locked(id, user, async (tx, row) => {
      if (
        row.status === 'PENDING' &&
        row.expiresAt > new Date() &&
        !row.multipartId
      ) {
        const multipartId = await this.storage.beginMultipart(
          row.objectKey,
          row.contentType,
        );
        row = await tx.mediaUpload.update({
          where: { id },
          data: { multipartId },
          include,
        });
      }
      return this.receipt(row);
    });
  }

  async list(user: AuthenticatedUser) {
    return this.db.$transaction(async (tx) => {
      await mediaAuthority(tx, user, true);
      const scope = {
        workspaceId: user.workspaceId,
        ownerUserId: user.id,
        manifest: { not: Prisma.DbNull },
      };
      const open = await tx.mediaUpload.findMany({
        where: { ...scope, status: { in: ['PENDING', 'FINALIZING'] } },
        include,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 12,
      });
      const recent = await tx.mediaUpload.findMany({
        where: { ...scope, status: { notIn: ['PENDING', 'FINALIZING'] } },
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50 - open.length,
      });
      return { items: [...open, ...recent].map((row) => this.receipt(row)) };
    });
  }

  async status(id: string, user: AuthenticatedUser) {
    return this.locked(id, user, async (tx, row) => {
      if (row.status === 'PENDING' && row.multipartId)
        row = await this.syncParts(tx, row);
      return this.receipt(row);
    });
  }

  async grant(id: string, number: number, user: AuthenticatedUser) {
    return this.locked(id, user, async (tx, row) => {
      this.pending(row);
      if (
        !Number.isInteger(number) ||
        number < 1 ||
        number > manifest(row).hashes.length
      )
        throw new BadRequestException(
          'Invalid part number or upload identity.',
        );
      // A durable reservation can survive a failed/lost S3 initialization.
      // Reloaded clients have the receipt, so recover that same upload here.
      if (!row.multipartId) {
        const multipartId = await this.storage.beginMultipart(
          row.objectKey,
          row.contentType,
        );
        row = await tx.mediaUpload.update({
          where: { id },
          data: { multipartId },
          include,
        });
      }
      const result = await this.storage.partUrl(
        row.objectKey,
        row.multipartId!,
        number,
        partSize(row.expectedSizeBytes, number),
        manifest(row).hashes[number - 1],
      );
      await tx.mediaUpload.update({
        where: { id },
        data: { lastGrantExpiresAt: result.expiresAt },
      });
      return result;
    });
  }

  async confirm(id: string, number: number, user: AuthenticatedUser) {
    return this.locked(id, user, async (tx, row) => {
      this.pending(row);
      row = await this.syncParts(tx, row);
      if (!row.parts.some((p) => p.number === number))
        throw new ConflictException(
          'Part is not confirmed by storage. Retry the part.',
        );
      return this.receipt(row);
    });
  }

  async complete(id: string, user: AuthenticatedUser) {
    // This intent survives storage completion followed by an API/DB failure.
    await this.locked(id, user, async (tx, row) => {
      if (row.status === 'PENDING') {
        this.pending(row);
        row = await this.syncParts(tx, row);
        if (row.parts.length !== manifest(row).hashes.length)
          throw new ConflictException('Some parts are still missing.');
        await tx.mediaUpload.update({
          where: { id },
          data: { status: 'FINALIZING', finalizingAt: new Date() },
        });
      }
    });
    const result = await this.locked(id, user, async (tx, row) => {
      if (row.status === 'UPLOADED') return this.receipt(row);
      if (row.status !== 'FINALIZING')
        throw new ConflictException('This upload can no longer be completed.');
      const existing = await this.headOrMissing(row.objectKey);
      if (!existing)
        await this.storage.completeMultipart(
          row.objectKey,
          row.multipartId!,
          row.parts,
        );
      const head = await this.storage.headObject(row.objectKey);
      if (
        head.contentLength !== row.expectedSizeBytes ||
        head.contentType !== row.contentType
      )
        return this.rejectIntegrity(tx, row);
      let sha256: string;
      try {
        sha256 = await this.verifyOriginal(row);
      } catch (error) {
        if (error instanceof BadRequestException)
          return this.rejectIntegrity(tx, row);
        throw error;
      }
      await this.media.registerUploaded(tx, row.id, row.mediaId, user, sha256);
      row = await tx.mediaUpload.findUniqueOrThrow({ where: { id }, include });
      return this.receipt(row);
    });
    if (result.status === 'UPLOADED') await this.media.enqueueUpload(id);
    return result;
  }

  async cancel(id: string, user: AuthenticatedUser) {
    const result = await this.locked(
      id,
      user,
      async (tx, row) => {
        if (['UPLOADED', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(row.status))
          return this.receipt(row);
        await tx.mediaAsset.update({
          where: { id: row.mediaId },
          data: {
            status: 'DELETED',
            cleanupPending: true,
            cleanupAfter: row.lastGrantExpiresAt ?? new Date(),
            processingProgress: 0,
          },
        });
        row = await tx.mediaUpload.update({
          where: { id },
          data: { status: 'CANCELLED' },
          include,
        });
        await this.audit.record(
          {
            workspaceId: user.workspaceId,
            actorId: user.id,
            action: 'media.upload_cancelled',
            entityType: 'MediaAsset',
            entityId: row.mediaId,
            summary: 'Cancelled a media upload; storage cleanup is durable.',
          },
          tx,
        );
        return this.receipt(row);
      },
      true,
    );
    return result;
  }

  private async rejectIntegrity(tx: Prisma.TransactionClient, row: Row) {
    await tx.mediaAsset.update({
      where: { id: row.mediaId },
      data: {
        status: 'FAILED',
        cleanupPending: true,
        cleanupAfter: new Date(),
        failureReason: 'Stored original failed content integrity verification.',
      },
    });
    const updated = await tx.mediaUpload.update({
      where: { id: row.id },
      data: {
        status: 'FAILED',
        failureReason: 'Stored file does not match the original file manifest.',
      },
      include,
    });
    return this.receipt(updated);
  }

  private pending(row: Row) {
    if (row.status !== 'PENDING' || row.expiresAt <= new Date())
      throw new ConflictException(
        'Upload is no longer open. Refresh the upload list.',
      );
  }

  private async syncParts(tx: Prisma.TransactionClient, row: Row) {
    if (!row.multipartId) return row;
    const parts = await this.storage.listParts(row.objectKey, row.multipartId);
    const hashes = manifest(row).hashes;
    if (
      parts.some(
        (p) =>
          p.number < 1 ||
          p.number > hashes.length ||
          p.sizeBytes !== partSize(row.expectedSizeBytes, p.number) ||
          p.sha256 !== hashes[p.number - 1],
      )
    )
      throw new ConflictException(
        'Storage parts do not match the file manifest. Cancel and upload the original again.',
      );
    await tx.mediaUploadPart.deleteMany({
      where: {
        uploadId: row.id,
        number: { notIn: parts.map((p) => p.number) },
      },
    });
    for (const part of parts)
      await tx.mediaUploadPart.upsert({
        where: { uploadId_number: { uploadId: row.id, number: part.number } },
        create: { uploadId: row.id, ...part },
        update: part,
      });
    return tx.mediaUpload.findUniqueOrThrow({ where: { id: row.id }, include });
  }

  private async headOrMissing(key: string) {
    try {
      return await this.storage.headObject(key);
    } catch (error) {
      if (['NotFound', 'NoSuchKey'].includes((error as Error).name))
        return null;
      throw error;
    }
  }

  private async verifyOriginal(row: Row) {
    const directory = await mkdtemp(join(tmpdir(), 'opspilot-upload-'));
    try {
      const path = join(directory, 'source');
      await this.storage.downloadToFile(row.objectKey, path);
      const hashes = manifest(row).hashes;
      let number = 0;
      let offset = 0;
      let total = 0;
      let part = createHash('sha256');
      const full = createHash('sha256');
      for await (const raw of createReadStream(path)) {
        const chunk = raw as Buffer;
        full.update(chunk);
        total += chunk.length;
        if (total > row.expectedSizeBytes)
          throw new BadRequestException('Invalid stored length.');
        let cursor = 0;
        while (cursor < chunk.length) {
          const length = Math.min(
            chunk.length - cursor,
            partSize(row.expectedSizeBytes, number + 1) - offset,
          );
          part.update(chunk.subarray(cursor, cursor + length));
          cursor += length;
          offset += length;
          if (offset === partSize(row.expectedSizeBytes, number + 1)) {
            if (part.digest('hex') !== hashes[number])
              throw new BadRequestException('Invalid stored digest.');
            number++;
            offset = 0;
            part = createHash('sha256');
          }
        }
      }
      if (total !== row.expectedSizeBytes || number !== hashes.length)
        throw new BadRequestException('Incomplete stored original.');
      return full.digest('hex');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async locked<T>(
    id: string,
    user: AuthenticatedUser,
    work: (tx: Prisma.TransactionClient, row: Row) => Promise<T>,
    allowManager = false,
  ): Promise<T> {
    try {
      return await this.db.$transaction(
        async (tx) => {
          const lookup = await tx.mediaUpload.findFirst({
            where: {
              id,
              workspaceId: user.workspaceId,
              manifest: { not: Prisma.DbNull },
            },
            select: { mediaId: true },
          });
          if (!lookup) throw new NotFoundException('Upload was not found.');
          await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${lookup.mediaId} FOR UPDATE`;
          const member = await mediaAuthority(tx, user, true);
          const row = await tx.mediaUpload.findUniqueOrThrow({
            where: { id },
            include,
          });
          if (
            row.ownerUserId !== user.id &&
            !(
              allowManager &&
              ['ADMIN', 'OPERATIONS_MANAGER'].includes(member.role)
            )
          )
            throw new ForbiddenException(
              'This upload belongs to another user.',
            );
          return work(tx, row);
        },
        { timeout: 60000, maxWait: 5000 },
      );
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error) throw error;
      throw new ServiceUnavailableException(
        'Media storage or database is temporarily unavailable. Retry to recover the same upload.',
      );
    }
  }

  private receipt(row: Row): UploadReceipt {
    const m = manifest(row);
    return {
      id: row.id,
      assetId: row.mediaId,
      clientOperationId: m.clientOperationId,
      name: m.name,
      kind: m.kind,
      contentType: row.contentType,
      sizeBytes: row.expectedSizeBytes,
      hashes: m.hashes,
      status: row.status,
      assetStatus: row.media.status,
      parts: row.parts.map((p) => ({
        number: p.number,
        sizeBytes: p.sizeBytes,
        sha256: p.sha256,
      })),
      expiresAt: row.expiresAt.toISOString(),
      failureReason: row.failureReason,
    };
  }
}
