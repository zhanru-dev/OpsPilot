import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks();
  new Logger('Worker').log('OpsPilot background worker is ready.');
}

void bootstrap();
