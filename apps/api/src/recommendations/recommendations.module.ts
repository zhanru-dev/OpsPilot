import { Module } from '@nestjs/common';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { OpenAiRecommendationProvider } from './openai-recommendation.provider';
import { RecommendationEvaluationService } from './recommendation-evaluation.service';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationSyncModule } from './recommendation-sync.module';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [RecommendationSyncModule, FeatureFlagsModule],
  controllers: [RecommendationsController],
  providers: [
    RecommendationsService,
    OpenAiRecommendationProvider,
    RecommendationEvaluationService,
  ],
})
export class RecommendationsModule {}
