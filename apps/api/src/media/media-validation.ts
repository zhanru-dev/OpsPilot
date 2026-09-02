import { BadRequestException } from '@nestjs/common';
import { MediaKind } from '@prisma/client';

type MediaProfile = {
  extension: string;
  kind: MediaKind;
};

export const MEDIA_PROFILES: Record<string, MediaProfile> = {
  'video/mp4': { extension: 'mp4', kind: MediaKind.VIDEO },
  'video/quicktime': { extension: 'mov', kind: MediaKind.VIDEO },
  'audio/mpeg': { extension: 'mp3', kind: MediaKind.AUDIO },
  'audio/wav': { extension: 'wav', kind: MediaKind.AUDIO },
  'audio/x-wav': { extension: 'wav', kind: MediaKind.AUDIO },
  'audio/mp4': { extension: 'm4a', kind: MediaKind.AUDIO },
};

const VIDEO_CODECS = new Set(['h264', 'hevc', 'mpeg4']);
const AUDIO_CODECS = new Set(['aac', 'mp3', 'pcm_s16le', 'pcm_s24le']);

export function requireUploadProfile(contentType: string, kind: MediaKind) {
  const normalized = contentType.toLowerCase();
  const profile = MEDIA_PROFILES[normalized];
  if (!profile || profile.kind !== kind) {
    throw new BadRequestException(
      'Use a supported MP4, MOV, MP3, WAV or M4A file whose MIME type matches its media kind.',
    );
  }
  return { ...profile, contentType: normalized };
}

export function assertProbedMedia(
  probe: {
    durationSeconds: number;
    videoCodec?: string;
    audioCodec?: string;
  },
  expectedKind: MediaKind,
  maxDurationSeconds: number,
) {
  if (!Number.isFinite(probe.durationSeconds) || probe.durationSeconds <= 0) {
    throw new Error(
      'MEDIA_DURATION_INVALID: ffprobe did not return a valid duration.',
    );
  }
  if (probe.durationSeconds > maxDurationSeconds) {
    throw new Error(
      `MEDIA_DURATION_EXCEEDED: Media must be ${maxDurationSeconds} seconds or shorter.`,
    );
  }
  if (expectedKind === MediaKind.VIDEO) {
    if (!probe.videoCodec || !VIDEO_CODECS.has(probe.videoCodec)) {
      throw new Error(
        `MEDIA_VIDEO_CODEC_UNSUPPORTED: Unsupported video codec ${probe.videoCodec ?? 'unknown'}.`,
      );
    }
  } else if (!probe.audioCodec || !AUDIO_CODECS.has(probe.audioCodec)) {
    throw new Error(
      `MEDIA_AUDIO_CODEC_UNSUPPORTED: Unsupported audio codec ${probe.audioCodec ?? 'unknown'}.`,
    );
  }
}

export function safeMediaName(value: string) {
  const clean = value.trim().replace(/[^a-zA-Z0-9._ -]/g, '-');
  return clean.slice(0, 200) || 'Untitled media';
}
