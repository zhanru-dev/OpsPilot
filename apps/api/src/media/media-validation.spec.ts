import { BadRequestException } from '@nestjs/common';
import { MediaKind } from '@prisma/client';
import {
  assertProbedMedia,
  requireUploadProfile,
  safeMediaName,
} from './media-validation';

describe('media validation', () => {
  it('normalises a supported MIME type and keeps its media kind', () => {
    expect(requireUploadProfile('VIDEO/MP4', MediaKind.VIDEO)).toEqual({
      extension: 'mp4',
      kind: MediaKind.VIDEO,
      contentType: 'video/mp4',
    });
  });

  it('rejects MIME and media-kind mismatches', () => {
    expect(() => requireUploadProfile('audio/mpeg', MediaKind.VIDEO)).toThrow(
      BadRequestException,
    );
  });

  it('rejects excessive duration and unsupported actual codecs', () => {
    expect(() =>
      assertProbedMedia(
        { durationSeconds: 301, videoCodec: 'h264' },
        MediaKind.VIDEO,
        300,
      ),
    ).toThrow('MEDIA_DURATION_EXCEEDED');
    expect(() =>
      assertProbedMedia(
        { durationSeconds: 30, videoCodec: 'vp9' },
        MediaKind.VIDEO,
        300,
      ),
    ).toThrow('MEDIA_VIDEO_CODEC_UNSUPPORTED');
  });

  it('removes unsafe filename characters', () => {
    expect(safeMediaName('  launch<script>.mp4  ')).toBe('launch-script-.mp4');
  });
});
