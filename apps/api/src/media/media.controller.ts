import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MediaKind, MediaStatus, MediaVariantKind } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MediaAccessGuard } from './media-access.guard';
import { mediaWriters } from './media-authority';
import type { AuthenticatedUser } from '../common/request-context';
import { CreateMediaUploadDto } from './dto/create-media-upload.dto';
import { MediaService } from './media.service';

@Controller('media-assets')
@UseGuards(MediaAccessGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: MediaStatus,
    @Query('kind') kind?: MediaKind,
    @Query('search') search?: string,
  ) {
    return this.media.list(user, { status, kind, search });
  }

  @Get('context')
  context(@CurrentUser() user: AuthenticatedUser) {
    return {
      userId: user.id,
      workspaceId: user.workspaceId,
      role: user.role,
      canUpload: mediaWriters.includes(user.role),
    };
  }

  @Delete(':id')
  deleteAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.deleteAsset(id, user);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.get(id, user);
  }

  @Post('uploads')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createUploadIntent(
    @Body() dto: CreateMediaUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.createUploadIntent(dto, user);
  }

  @Post('uploads/:uploadId/complete')
  completeUpload(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.completeUpload(uploadId, user);
  }

  @Post(':id/playback-url')
  playbackUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.createPlaybackUrl(id, user);
  }

  @Post(':id/thumbnail-url')
  thumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.createPlaybackUrl(id, user, MediaVariantKind.THUMBNAIL);
  }

  @Post(':id/retry-processing')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  retryProcessing(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.retryProcessing(id, user);
  }

  @Post(':id/simulate-successful-retry')
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.retry(id, user);
  }

  @Post(':mediaId/attach-to/:eventId')
  attach(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.attach(mediaId, eventId, user);
  }

  @Delete(':mediaId/detach-from/:eventId')
  detach(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.detach(mediaId, eventId, user);
  }
}
