// Test-only fault harness, never imported by an application entry point.
require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("../apps/api/dist/app.module");
const { WorkerModule } = require("../apps/api/dist/worker.module");
const { configureApp } = require("../apps/api/dist/configure-app");
const { MediaService } = require("../apps/api/dist/media/media.service");
const {
  StorageService,
} = require("../apps/api/dist/infrastructure/storage/storage.service");
(async () => {
  if (
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test") ||
    !process.send
  )
    throw Error("Disposable IPC test harness only");
  const worker = process.argv[2] === "worker";
  const app = worker
    ? await NestFactory.createApplicationContext(WorkerModule, {
        logger: false,
      })
    : await NestFactory.create(AppModule, { logger: false });
  if (process.argv[3] === "hold") {
    if (worker) {
      const storage = app.get(StorageService),
        original = storage.uploadFile.bind(storage);
      storage.uploadFile = async (...args) => {
        const size = await original(...args);
        process.send({ event: "stored-derivative" });
        await new Promise(() => {});
        return size;
      };
    } else {
      app.get(MediaService).registerUploaded = async () => {
        process.send({ event: "stored-original" });
        await new Promise(() => {});
      };
    }
  }
  if (!worker) {
    configureApp(app);
    await app.listen(0, "127.0.0.1");
  }
  process.send({
    event: "ready",
    url: worker ? undefined : await app.getUrl(),
  });
  process.on("SIGTERM", () => void app.close().then(() => process.exit(0)));
})().catch(() => {
  process.send?.({ event: "startup-error" });
  process.exit(1);
});
