import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MultipartService } from './multipart.service';
import { MultipartController } from './multipart.controller';
import { MediaAccessGuard } from './media-access.guard';

@Module({
  controllers: [MultipartController, MediaController],
  providers: [MediaService, MultipartService, MediaAccessGuard],
})
export class MediaModule {}
