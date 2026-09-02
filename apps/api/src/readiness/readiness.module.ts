import { Global, Module } from '@nestjs/common';
import { RecommendationSyncModule } from '../recommendations/recommendation-sync.module';
import { ReadinessService } from './readiness.service';

@Global()
@Module({
  imports: [RecommendationSyncModule],
  providers: [ReadinessService],
  exports: [ReadinessService],
})
export class ReadinessModule {}
