import { Global, Module } from '@nestjs/common';
import { RequestTraceService } from './request-trace.service';

@Global()
@Module({
  providers: [RequestTraceService],
  exports: [RequestTraceService],
})
export class RequestTraceModule {}
