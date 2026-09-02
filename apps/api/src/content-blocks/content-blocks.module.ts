import { Module } from '@nestjs/common';
import { ContentBlocksController } from './content-blocks.controller';

@Module({ controllers: [ContentBlocksController] })
export class ContentBlocksModule {}
