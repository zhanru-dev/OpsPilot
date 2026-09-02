import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MediaKind, MediaStatus, WorkspaceRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { CreateMediaUploadDto } from './dto/create-media-upload.dto';
import { MediaService } from './media.service';

const mediaMutators = [
  WorkspaceRole.ADMIN,
  WorkspaceRole.OPERATIONS_MANAGER,
  WorkspaceRole.CONTENT_OPERATOR,
] as const;

@Controller('media-assets')
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

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.get(id, user);
  }

  @Post('uploads')
  @Roles(...mediaMutators)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createUploadIntent(
    @Body() dto: CreateMediaUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.createUploadIntent(dto, user);
  }

  @Post('uploads/:uploadId/complete')
  @Roles(...mediaMutators)
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

  @Post(':id/retry-processing')
  @Roles(...mediaMutators)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  retryProcessing(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.retryProcessing(id, user);
  }

  @Post(':id/simulate-successful-retry')
  @Roles(...mediaMutators)
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.retry(id, user);
  }

  @Post(':mediaId/attach-to/:eventId')
  @Roles(...mediaMutators)
  attach(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.attach(mediaId, eventId, user);
  }

  @Delete(':mediaId/detach-from/:eventId')
  @Roles(...mediaMutators)
  detach(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.detach(mediaId, eventId, user);
  }
}
