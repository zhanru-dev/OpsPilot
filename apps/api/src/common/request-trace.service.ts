import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

@Injectable()
export class RequestTraceService {
  private readonly storage = new AsyncLocalStorage<{ traceId: string }>();

  run<T>(traceId: string, callback: () => T) {
    return this.storage.run({ traceId }, callback);
  }

  current() {
    return this.storage.getStore()?.traceId;
  }
}
