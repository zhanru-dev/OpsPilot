import { BadRequestException, Injectable, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { EventPrincipal } from '../event-interactions/event-identity.service';
import { BroadcastService, principalKey } from './broadcast.service';
import { MediaMtxService } from './mediamtx.service';
import {
  mediaUnavailable,
  rewritePlaylist,
  safeFile,
  safeId,
} from './media-utils';
@Injectable()
export class MediaRelayService {
  private slots = 0;
  private readonly owners = new Map<string, number>();
  constructor(
    private readonly broadcasts: BroadcastService,
    private readonly media: MediaMtxService,
  ) {}
  async content(
    eventId: string,
    id: string,
    file: string,
    ticket: unknown,
    reader: unknown,
    principal: EventPrincipal,
    base: string,
    response: Response,
  ) {
    if (!safeFile(file) || (reader !== undefined && !safeId(reader)))
      throw new BadRequestException('Invalid media path.');
    const key = principalKey(principal),
      count = this.owners.get(key) ?? 0;
    if (this.slots >= 64 || count >= 8)
      throw new HttpException('Too many concurrent media requests.', 429);
    // Reserve before the first await; release in every outcome, including client abort.
    this.slots++;
    this.owners.set(key, count + 1);
    const controller = new AbortController(),
      close = () => controller.abort();
    const timeout = setTimeout(close, 15000);
    response.once('close', close);
    let source: Readable | undefined, sourceFailure: Error | undefined;
    try {
      await this.broadcasts.playbackAccess(eventId, id, ticket, principal);
      const upstream = await this.media.hls(
        id,
        file,
        controller.signal,
        reader,
      );
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel();
        throw mediaUnavailable();
      }
      source = Readable.fromWeb(
        upstream.body as import('node:stream/web').ReadableStream,
      );
      source.on('error', (error: Error) => {
        sourceFailure = error;
      });
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (file.endsWith('.m3u8')) {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const value of source) {
          const chunk: unknown = value;
          if (!Buffer.isBuffer(chunk)) throw mediaUnavailable();
          size += chunk.length;
          if (size > 256 * 1024) throw mediaUnavailable();
          chunks.push(chunk);
        }
        const body = rewritePlaylist(
          Buffer.concat(chunks).toString('utf8'),
          base,
          ticket as string,
        );
        await this.broadcasts.playbackAccess(eventId, id, ticket, principal);
        response.type('application/vnd.apple.mpegurl').send(body);
      } else {
        await this.broadcasts.playbackAccess(eventId, id, ticket, principal);
        if (sourceFailure || controller.signal.aborted)
          throw mediaUnavailable();
        let bytes = 0;
        const bounded = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            bytes += chunk.length;
            done(bytes > 12 * 1024 * 1024 ? mediaUnavailable() : null, chunk);
          },
        });
        response.type(file.endsWith('.ts') ? 'video/mp2t' : 'video/mp4');
        await pipeline(source, bounded, response, {
          signal: controller.signal,
        });
      }
    } catch (error) {
      if (!response.destroyed && !response.headersSent)
        throw error instanceof HttpException ? error : mediaUnavailable();
      if (!response.destroyed) response.destroy();
    } finally {
      clearTimeout(timeout);
      response.off('close', close);
      source?.destroy();
      controller.abort();
      this.slots--;
      const left = (this.owners.get(key) ?? 1) - 1;
      if (left) this.owners.set(key, left);
      else this.owners.delete(key);
    }
  }
}
