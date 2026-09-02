import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { RolesGuard } from './common/guards/roles.guard';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { AuditModule } from './audit/audit.module';
import { ReadinessModule } from './readiness/readiness.module';
import { EventsModule } from './events/events.module';
import { AccessPoliciesModule } from './access-policies/access-policies.module';
import { ContentBlocksModule } from './content-blocks/content-blocks.module';
import { MediaModule } from './media/media.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { DomainEventsModule } from './domain-events/domain-events.module';
import { QueuesModule } from './infrastructure/queues/queues.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { RequestTraceModule } from './common/request-trace.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ErrorReportsModule } from './error-reports/error-reports.module';
import { ApiExceptionFilter } from './error-reports/api-exception.filter';
import { configModuleOptions } from './config/environment';

@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    RequestTraceModule,
    QueuesModule,
    StorageModule,
    DomainEventsModule,
    IntegrationsModule,
    FeatureFlagsModule,
    AnalyticsModule,
    ErrorReportsModule,
    AuthModule,
    AuditModule,
    ReadinessModule,
    EventsModule,
    AccessPoliciesModule,
    ContentBlocksModule,
    MediaModule,
    RecommendationsModule,
    DashboardModule,
    WorkspacesModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
