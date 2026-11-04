import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { MediaAccessGuard } from './media-access.guard';
import { MultipartUploadDto } from './dto/multipart-upload.dto';
import { MultipartService } from './multipart.service';
@Controller('media-assets/multipart')
@UseGuards(MediaAccessGuard)
export class MultipartController {
  constructor(private readonly uploads: MultipartService) {}
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  init(
    @Body() dto: MultipartUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uploads.init(dto, user);
  }
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.uploads.list(user);
  }
  @Get(':id')
  status(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uploads.status(id, user);
  }
  @Post(':id/parts/:number')
  @Throttle({ default: { limit: 600, ttl: 60000 } })
  grant(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('number', ParseIntPipe) number: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uploads.grant(id, number, user);
  }
  @Post(':id/parts/:number/confirm')
  @Throttle({ default: { limit: 600, ttl: 60000 } })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('number', ParseIntPipe) number: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uploads.confirm(id, number, user);
  }
  @Post(':id/complete')
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uploads.complete(id, user);
  }
  @Post(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uploads.cancel(id, user);
  }
}
