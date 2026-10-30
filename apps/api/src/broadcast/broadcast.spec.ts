import { broadcastCapabilities, principalKey } from './broadcast.service';
import {
  availability,
  rewritePlaylist,
  safeFile,
  sameSecret,
} from './media-utils';
import { diagnosticPath, redactDiagnostic } from '../error-reports/redact';

describe('Broadcast policy and media boundary', () => {
  it('keeps publication separate from management and event operations', () => {
    expect(broadcastCapabilities('CONTENT_OPERATOR', 'READY')).toMatchObject({
      view: true,
      publish: true,
      manage: false,
      start: false,
    });
    expect(broadcastCapabilities('ATTENDEE', 'LIVE')).toMatchObject({
      view: true,
      publish: false,
      manage: false,
    });
    expect(
      broadcastCapabilities('OPERATIONS_MANAGER', 'COMPLETED'),
    ).toMatchObject({
      view: false,
      publish: false,
      manage: true,
      start: false,
    });
    expect(broadcastCapabilities('VIEWER', 'DRAFT').view).toBe(false);
  });
  it('canonicalizes principal fields independently of JSON field order', () => {
    const a = {
      kind: 'staff' as const,
      userId: 'a',
      sessionId: 'b',
      workspaceId: 'c',
    };
    expect(principalKey(a)).toBe(
      principalKey({
        workspaceId: 'c',
        sessionId: 'b',
        userId: 'a',
        kind: 'staff',
      }),
    );
    expect(principalKey(a)).not.toBe(principalKey({ ...a, sessionId: 'd' }));
  });
  it('protects variant, initialization and segment resources without exposing upstream credentials', () => {
    const session = '11111111-1111-4111-8111-111111111111';
    const result = rewritePlaylist(
      `#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nstream.m3u8?session=${session}\nseg1.mp4\n`,
      '/protected',
      'abc',
    );
    expect(result).toContain('URI="/protected/init.mp4?ticket=abc"');
    expect(result).toContain(
      `/protected/stream.m3u8?ticket=abc&session=${session}`,
    );
    expect(result).toContain('/protected/seg1.mp4?ticket=abc');
  });
  it.each([
    '../file.mp4',
    'https://attacker/a.mp4',
    '//attacker/a.mp4',
    'file.mp4?token=secret',
    'file.mp4?session=bad',
    'file%2emp4',
  ])('rejects unsafe media references: %s', (reference) => {
    expect(() =>
      rewritePlaylist(`#EXTM3U\n${reference}`, '/protected', 'abc'),
    ).toThrow();
  });
  it('does not treat control failure as proof that a stream ended', () => {
    expect(availability(null, false, true)).toBe('UNKNOWN');
    expect(availability(null, false, false)).toBe('WAITING');
    expect(availability(new Date(), false, false)).toBe('INTERRUPTED');
    expect(availability(null, true, false)).toBe('LIVE');
    expect(safeFile('a..b.mp4')).toBe(false);
    expect(sameSecret('short', 'longer')).toBe(false);
  });
  it('redacts credentials before persistent error reporting', () => {
    const secret = 'a'.repeat(64);
    const body = redactDiagnostic(
      `fetch http://relay:${secret}@127.0.0.1/a?ticket=${secret}&pass=raw-password Authorization: Basic YWJjZGVm`,
    );
    expect(body).not.toContain(secret);
    expect(body).not.toContain('raw-password');
    expect(body).not.toContain('YWJjZGVm');
    expect(diagnosticPath(`/api/hls/a.mp4?ticket=${secret}&session=123`)).toBe(
      '/api/hls/a.mp4',
    );
  });
});
