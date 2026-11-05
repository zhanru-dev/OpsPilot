import {
  CreateBucketCommand,
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
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

  // The destination is server-owned and never receives a client write grant.
  async copyObject(source: string, destination: string, etag: string) {
    await this.internalClient.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destination,
        CopySource: `${encodeURIComponent(this.bucket)}/${source.split('/').map(encodeURIComponent).join('/')}`,
        CopySourceIfMatch: etag,
      }),
    );
  }

  async sha256Object(objectKey: string, expectedBytes: number) {
    const result = await this.internalClient.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { abortSignal: AbortSignal.timeout(60000) },
    );
    if (!(result.Body instanceof Readable))
      throw new Error('Object storage returned an unsupported response body.');
    const body = result.Body;
    const timer = setTimeout(
      () => body.destroy(new Error('Media verification timed out.')),
      60000,
    );
    let bytes = 0;
    const hash = createHash('sha256');
    try {
      for await (const chunk of body) {
        const buffer = chunk as Buffer;
        bytes += buffer.length;
        if (bytes > expectedBytes || bytes > 104857600)
          throw new Error('Stored original exceeds its upload size limit.');
        hash.update(buffer);
      }
      if (bytes !== expectedBytes)
        throw new Error('Stored original size mismatch.');
      return hash.digest('hex');
    } finally {
      clearTimeout(timer);
      body.destroy();
    }
  }

  async downloadToFile(objectKey: string, destination: string) {
    const result = await this.internalClient.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    if (!(result.Body instanceof Readable)) {
      throw new Error('Object storage returned an unsupported response body.');
    }
    let bytes = 0;
    const bound = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(
          bytes > 104857600
            ? new Error(
                'MEDIA_SOURCE_TOO_LARGE: Stored original exceeds 100 MiB.',
              )
            : null,
          chunk,
        );
      },
    });
    await pipeline(result.Body, bound, createWriteStream(destination), {
      signal: AbortSignal.timeout(60000),
    });
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
      const result = await this.internalClient.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      if (result.Errors?.length)
        throw new Error('Some media objects could not be removed.');
    }
  }

  async checkHealth(abortSignal?: AbortSignal) {
    await this.internalClient.send(
      new HeadBucketCommand({ Bucket: this.bucket }),
      { abortSignal },
    );
  }

  async listOwnedObjects(workspaceId: string, mediaId: string) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const result = await this.internalClient.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `workspaces/${workspaceId}/media/${mediaId}/`,
          ContinuationToken: token,
        }),
      );
      for (const object of result.Contents ?? [])
        if (object.Key) keys.push(object.Key);
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  private createClient(endpoint: string) {
    return new S3Client({
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 3000, requestTimeout: 15000 },
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

  async beginMultipart(key: string, contentType: string) {
    await this.abortMultipartForKey(key);
    const result = await this.internalClient.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ChecksumAlgorithm: 'SHA256',
      }),
    );
    if (!result.UploadId)
      throw new Error('Storage returned no upload identity');
    return result.UploadId;
  }

  async partUrl(
    key: string,
    uploadId: string,
    number: number,
    size: number,
    sha256: string,
  ) {
    const checksum = Buffer.from(sha256, 'hex').toString('base64');
    const url = await getSignedUrl(
      this.publicClient,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: number,
        ContentLength: size,
        ChecksumSHA256: checksum,
      }),
      { expiresIn: 60, unhoistableHeaders: new Set(['x-amz-checksum-sha256']) },
    );
    return {
      url,
      headers: { 'x-amz-checksum-sha256': checksum },
      expiresAt: new Date(Date.now() + 60000),
    };
  }

  async listParts(key: string, uploadId: string) {
    const parts: {
      number: number;
      sizeBytes: number;
      etag: string;
      sha256: string;
    }[] = [];
    let marker: string | undefined;
    do {
      const page = await this.internalClient.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const part of page.Parts ?? [])
        parts.push({
          number: part.PartNumber!,
          sizeBytes: part.Size!,
          etag: part.ETag!,
          sha256: part.ChecksumSHA256
            ? Buffer.from(part.ChecksumSHA256, 'base64').toString('hex')
            : '',
        });
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker);
    return parts;
  }

  async completeMultipart(
    key: string,
    uploadId: string,
    parts: { number: number; etag: string; sha256: string }[],
  ) {
    await this.internalClient.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((p) => ({
            PartNumber: p.number,
            ETag: p.etag,
            ChecksumSHA256: Buffer.from(p.sha256, 'hex').toString('base64'),
          })),
        },
      }),
    );
  }

  async abortMultipartForKey(key: string) {
    let keyMarker: string | undefined;
    let uploadMarker: string | undefined;
    do {
      const page = await this.internalClient.send(
        new ListMultipartUploadsCommand({
          Bucket: this.bucket,
          Prefix: key,
          KeyMarker: keyMarker,
          UploadIdMarker: uploadMarker,
        }),
      );
      for (const upload of page.Uploads ?? [])
        if (upload.Key === key && upload.UploadId) {
          try {
            await this.internalClient.send(
              new AbortMultipartUploadCommand({
                Bucket: this.bucket,
                Key: key,
                UploadId: upload.UploadId,
              }),
            );
          } catch (error) {
            if ((error as Error).name !== 'NoSuchUpload') throw error;
          }
        }
      keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
      uploadMarker = page.NextUploadIdMarker;
    } while (keyMarker);
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
