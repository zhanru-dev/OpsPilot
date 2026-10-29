// Explicit test entry point, excluded from the production build. No fault routes
// or environment-controlled fault branches are added to application modules.
import { NestFactory } from '@nestjs/core';
import { ServiceUnavailableException } from '@nestjs/common';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { ChatService } from '../src/event-chat/chat.service';
import { PrismaService } from '../src/prisma/prisma.service';

type Fault = {
  id: string;
  eventId: string;
  actor: 'staff' | 'attendee';
  stage: 'subscription' | 'replay';
  mode: 'database-lock' | 'unavailable';
};

async function bootstrap() {
  const directory = process.env.CHAT_RECOVERY_FAULT_DIR;
  if (
    process.env.NODE_ENV !== 'test' ||
    !new URL(process.env.DATABASE_URL!).pathname.endsWith('_test') ||
    !directory
  )
    throw new Error(
      'Recovery harness requires explicit test mode, *_test database and fault directory.',
    );
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  const chat = app.get(ChatService);
  const db = app.get(PrismaService);
  const history = chat.history.bind(chat);
  const replay = chat.replay.bind(chat);
  function take(eventId: string, actor: string, stage: Fault['stage']) {
    const path = join(directory!, 'fault.json');
    if (!existsSync(path)) return;
    const fault = JSON.parse(readFileSync(path, 'utf8')) as Fault;
    if (
      fault.eventId !== eventId ||
      fault.actor !== actor ||
      fault.stage !== stage
    )
      return;
    unlinkSync(path); // Consume synchronously before any await: one failure only.
    return fault;
  }
  async function apply<T>(
    fault: Fault,
    operation: () => Promise<T>,
  ): Promise<T> {
    let blocker: Promise<void> | undefined;
    try {
      if (fault.mode === 'unavailable')
        throw new ServiceUnavailableException('Temporary recovery test outage');
      let acquired!: () => void;
      const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      blocker = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "StreamEvent" WHERE "id" = ${fault.eventId} FOR UPDATE`;
          acquired();
          await delay(6500); // Exceeds the actual service's 5-second transaction timeout.
        },
        { timeout: 10000 },
      );
      await Promise.race([locked, blocker]);
      return await operation();
    } catch (error) {
      writeFileSync(
        join(directory!, 'applied.json'),
        JSON.stringify({
          ...fault,
          status:
            error instanceof ServiceUnavailableException
              ? error.getStatus()
              : null,
        }),
      );
      throw error;
    } finally {
      await blocker;
    }
  }
  chat.history = (eventId, principal, query) => {
    const fault =
      query.limit === 1
        ? take(eventId, principal.kind, 'subscription')
        : undefined;
    return fault
      ? apply(fault, () => history(eventId, principal, query))
      : history(eventId, principal, query);
  };
  chat.replay = (eventId, principal, query, deliver) => {
    // Only gateway replay has a deliver callback; ordinary REST remains real.
    const fault = deliver ? take(eventId, principal.kind, 'replay') : undefined;
    return fault
      ? apply(fault, () => replay(eventId, principal, query, deliver))
      : replay(eventId, principal, query, deliver);
  };
  await app.listen(Number(process.env.API_PORT ?? 4100), '127.0.0.1');
  console.log('Chat recovery test API ready.');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      void app.close().then(() => process.exit(0));
    });
}
void bootstrap().catch(() => {
  console.error('Chat recovery test API failed to start.');
  process.exit(1);
});
