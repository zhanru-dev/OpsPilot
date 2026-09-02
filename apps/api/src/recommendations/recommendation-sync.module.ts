import { Module } from '@nestjs/common';
import { RecommendationSyncService } from './recommendation-sync.service';

@Module({
  providers: [RecommendationSyncService],
  exports: [RecommendationSyncService],
})
export class RecommendationSyncModule {}
