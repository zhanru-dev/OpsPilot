import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../infrastructure/storage/storage.service';

jest.mock('ioredis', () => jest.fn());
describe('Bounded readiness independently of worker retry policy', () => {
  const connect = jest.fn(),
    ping = jest.fn(),
    disconnect = jest.fn();
  const database = jest.fn(),
    storage = jest.fn();
  let service: HealthService;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    connect.mockResolvedValue(undefined);
    ping.mockResolvedValue('PONG');
    (Redis as unknown as jest.Mock).mockImplementation(() => ({
      connect,
      ping,
      disconnect,
      on: jest.fn(),
    }));
    database.mockResolvedValue([{ '?column?': 1 }]);
    storage.mockResolvedValue(undefined);
    service = new HealthService(
      { $transaction: database } as unknown as PrismaService,
      { checkHealth: storage } as unknown as StorageService,
      new ConfigService({ REDIS_URL: 'redis://localhost:6379' }),
      {} as Queue,
      {} as Queue,
      {} as Queue,
      {} as Queue,
    );
  });
  afterEach(() => jest.useRealTimers());
  it('shares concurrent probes and closes the separate nonretrying Redis connection', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => service.readiness()),
    );
    expect(responses.every((r) => r.status === 'ready')).toBe(true);
    expect(database).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(Redis).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
        commandTimeout: 1000,
      }),
    );
  });
  it('bounds a hung database without queuing unlimited probes and recovers after it settles', async () => {
    let finish!: () => void;
    database.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    const failed = service.readiness().catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(1001);
    expect(await failed).toBeInstanceOf(ServiceUnavailableException);
    for (let i = 0; i < 10; i++)
      await expect(service.readiness()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    expect(database).toHaveBeenCalledTimes(1);
    finish();
    await jest.advanceTimersByTimeAsync(0);
    await expect(service.readiness()).resolves.toMatchObject({
      status: 'ready',
    });
    expect(database).toHaveBeenCalledTimes(2);
  });
  it('marks an unavailable dependency down while liveness remains a separate controller', async () => {
    ping.mockRejectedValue(new Error('unavailable'));
    await expect(service.readiness()).rejects.toMatchObject({
      response: {
        status: 'not_ready',
        dependencies: { queues: 'down', database: 'up', objectStorage: 'up' },
      },
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(storage).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
});
