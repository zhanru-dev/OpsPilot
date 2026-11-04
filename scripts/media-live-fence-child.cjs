// Test-only IPC barriers. Real PG, Redis Job, S3 and FFmpeg; no application route.
require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");
const { getQueueToken } = require("@nestjs/bullmq");
const { AppModule } = require("../apps/api/dist/app.module");
const { PrismaService } = require("../apps/api/dist/prisma/prisma.service");
const { ConfigService } = require("@nestjs/config");
const {
  StorageService,
} = require("../apps/api/dist/infrastructure/storage/storage.service");
const { AuditService } = require("../apps/api/dist/audit/audit.service");
const {
  DomainEventsService,
} = require("../apps/api/dist/domain-events/domain-events.service");
const {
  ReadinessService,
} = require("../apps/api/dist/readiness/readiness.service");
const {
  MediaProcessingProcessor,
} = require("../apps/api/dist/media/media-processing.processor");
(async () => {
  if (
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test") ||
    !process.send
  )
    throw Error("Disposable IPC test harness only");
  const [jobId, barrier] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const store = app.get(StorageService);
  const processor = new MediaProcessingProcessor(
    app.get(PrismaService),
    store,
    app.get(ConfigService),
    app.get(AuditService),
    app.get(DomainEventsService),
    app.get(ReadinessService),
  );
  let localFile;
  const download = store.downloadToFile.bind(store);
  const pause = () =>
    new Promise((resolve) => {
      process.once("message", (message) => {
        if (message === "resume") resolve();
      });
      process.send({ event: "held", localFile });
    });
  store.downloadToFile = async (...args) => {
    await download(...args);
    localFile = args[1];
    if (barrier === "progress") await pause();
  };
  const progress = processor.updateProgress.bind(processor);
  processor.updateProgress = async (...args) => {
    await progress(...args);
    if (
      (barrier === "write" && args[3] === 75) ||
      (barrier === "commit" && args[3] === 90)
    )
      await pause();
  };
  const job = await app.get(getQueueToken("media-processing")).getJob(jobId);
  if (!job) throw Error("Real persisted queue job missing");
  const result = await processor.process(job);
  process.send({ event: "done", result, localFile });
  await app.close();
})().catch((error) => {
  process.send?.({ event: "error", message: error.message });
  process.exitCode = 1;
});
