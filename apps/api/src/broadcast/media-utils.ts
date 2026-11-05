import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
export const mediaUnavailable = () =>
  new ServiceUnavailableException(
    'Streaming infrastructure is unavailable. Retrying shortly.',
  );
export function sameSecret(value: unknown, expected: string) {
  return (
    typeof value === 'string' &&
    Buffer.byteLength(value) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}
export const safeId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export const safeKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function safeFile(file: string) {
  return (
    /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,180}\.(m3u8|mp4|m4s|ts)$/.test(file) &&
    !file.includes('..')
  );
}
export function rewritePlaylist(text: string, base: string, ticket: string) {
  if (!text.startsWith('#EXTM3U')) throw mediaUnavailable();
  const protect = (reference: string) => {
    const [file, query, extra] = reference.split('?');
    const params = new URLSearchParams(query);
    const session = params.get('session');
    if (
      !safeFile(file) ||
      extra !== undefined ||
      (query !== undefined && (params.size !== 1 || !safeId(session)))
    )
      throw new BadRequestException('Invalid upstream media reference.');
    return `${base}/${file}?ticket=${encodeURIComponent(ticket)}${session ? `&session=${session}` : ''}`;
  };
  // Tag lines may carry URI="..." attributes; other non-empty lines are media URIs.
  const rewriteLine = (line: string) => {
    if (line.startsWith('#'))
      return line.replace(
        /URI="([^"]+)"/g,
        (_, uri: string) => `URI="${protect(uri)}"`,
      );
    return line.trim() ? protect(line.trim()) : line;
  };
  return text.split('\n').map(rewriteLine).join('\n');
}
export function availability(
  firstLiveAt: Date | null,
  online: boolean,
  failed: boolean,
) {
  // Order matters: an unreachable media server makes the state unknown, even
  // if a publisher was previously seen.
  if (failed) return 'UNKNOWN' as const;
  if (online) return 'LIVE' as const;
  return firstLiveAt ? ('INTERRUPTED' as const) : ('WAITING' as const);
}
