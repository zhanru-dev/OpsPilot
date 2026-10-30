import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mediaUnavailable, safeId } from './media-utils';
export type MediaPath = {
  available: boolean;
  online: boolean;
  source: { id: string; type: string } | null;
};
@Injectable()
export class MediaMtxService {
  constructor(private readonly config: ConfigService) {}
  enabled() {
    return this.config.get<string>('BROADCAST_ENABLED') === 'true';
  }
  secret() {
    const value = this.config.get<string>('BROADCAST_INTERNAL_SECRET') ?? '';
    if (!/^[a-f0-9]{64}$/.test(value))
      throw new Error(
        'Broadcast requires a generated internal secret. Run broadcast setup.',
      );
    return value;
  }
  headers() {
    return {
      Authorization: `Basic ${Buffer.from(`relay:${this.secret()}`).toString('base64')}`,
    };
  }
  async path(id: string): Promise<MediaPath | null> {
    const response = await fetch(
      `${this.config.get<string>('BROADCAST_CONTROL_URL') ?? 'http://127.0.0.1:9999'}/v3/paths/get/live/${id}`,
      { headers: this.headers(), signal: AbortSignal.timeout(2000) },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw mediaUnavailable();
    const data = (await response.json()) as MediaPath;
    if (
      typeof data.available !== 'boolean' ||
      typeof data.online !== 'boolean' ||
      (data.source !== null && !safeId(data.source?.id))
    )
      throw mediaUnavailable();
    return data;
  }
  async kick(connectionId: string) {
    if (!safeId(connectionId)) throw mediaUnavailable();
    const response = await fetch(
      `${this.config.get<string>('BROADCAST_CONTROL_URL') ?? 'http://127.0.0.1:9999'}/v3/rtmp/conns/kick/${connectionId}`,
      {
        method: 'POST',
        headers: this.headers(),
        signal: AbortSignal.timeout(2000),
      },
    );
    if (!response.ok && response.status !== 404) throw mediaUnavailable();
  }
  async hls(id: string, file: string, signal: AbortSignal, reader?: string) {
    const url = new URL(
      `${this.config.get<string>('BROADCAST_HLS_URL') ?? 'http://127.0.0.1:8890'}/live/${id}/${file}`,
    );
    if (reader) url.searchParams.set('session', reader);
    const options = {
      headers: this.headers(),
      signal,
      redirect: 'manual' as const,
    };
    const response = await fetch(url, options);
    if (![301, 302, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw mediaUnavailable();
    const next = new URL(location, url);
    if (
      next.origin !== url.origin ||
      next.pathname !== url.pathname ||
      next.searchParams.size !== 1 ||
      !(
        safeId(next.searchParams.get('session')) ||
        next.searchParams.get('cookieCheck') === '1'
      )
    )
      throw mediaUnavailable();
    return fetch(next, options);
  }
}
