import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

type ObjectMetadata = {
  contentLength: number;
  contentType: string | null;
  etag: string | null;
};

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly bucket: string;
  private readonly internalClient: S3Client;
  private readonly publicClient: S3Client;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.internalClient = this.createClient(
      config.getOrThrow<string>('S3_ENDPOINT'),
    );
    this.publicClient = this.createClient(
      config.getOrThrow<string>('S3_PUBLIC_ENDPOINT'),
    );
  }

  async onModuleInit() {
    await this.ensureBucket();
  }

  async createUploadUrl(
    objectKey: string,
    contentType: string,
    contentLength: number,
    expiresIn: number,
  ) {
    return getSignedUrl(
      this.publicClient,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      { expiresIn },
    );
  }

  async createPlaybackUrl(
    objectKey: string,
    contentType: string,
    expiresIn: number,
  ) {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ResponseContentType: contentType,
      }),
      { expiresIn },
    );
  }

  async headObject(objectKey: string): Promise<ObjectMetadata> {
    const result = await this.internalClient.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    return {
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType ?? null,
      etag: result.ETag ?? null,
    };
  }

  async downloadToFile(objectKey: string, destination: string) {
    const result = await this.internalClient.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    if (!(result.Body instanceof Readable)) {
      throw new Error('Object storage returned an unsupported response body.');
    }
    await pipeline(result.Body, createWriteStream(destination));
  }

  async uploadFile(objectKey: string, source: string, contentType: string) {
    const file = await stat(source);
    await this.internalClient.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: createReadStream(source),
        ContentType: contentType,
        ContentLength: file.size,
      }),
    );
    return file.size;
  }

  async deleteObjects(objectKeys: string[]) {
    const uniqueKeys = [...new Set(objectKeys)].filter(Boolean);
    for (let index = 0; index < uniqueKeys.length; index += 1_000) {
      const batch = uniqueKeys.slice(index, index + 1_000);
      await this.internalClient.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    }
  }

  async checkHealth() {
    await this.internalClient.send(
      new HeadBucketCommand({ Bucket: this.bucket }),
    );
  }

  private createClient(endpoint: string) {
    return new S3Client({
      endpoint,
      region: this.config.getOrThrow<string>('S3_REGION'),
      forcePathStyle: this.config.getOrThrow<boolean>('S3_FORCE_PATH_STYLE'),
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('S3_SECRET_KEY'),
      },
    });
  }

  private async ensureBucket() {
    try {
      await this.internalClient.send(
        new HeadBucketCommand({ Bucket: this.bucket }),
      );
    } catch (error) {
      const status = this.statusCode(error);
      const autoCreate = this.config.getOrThrow<boolean>(
        'S3_AUTO_CREATE_BUCKET',
      );
      if (status !== 404 || !autoCreate) throw error;
      try {
        await this.internalClient.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
      } catch (createError) {
        if (this.statusCode(createError) !== 409) throw createError;
        await this.internalClient.send(
          new HeadBucketCommand({ Bucket: this.bucket }),
        );
      }
    }
  }

  private statusCode(error: unknown) {
    return (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
  }
}
