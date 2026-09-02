import { NotFoundException } from '@nestjs/common';
import { RunbookStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecommendationSyncService } from '../recommendations/recommendation-sync.service';
import { ReadinessService } from './readiness.service';

describe('ReadinessService', () => {
  const findFirst = jest.fn();
  const prisma = {
    streamEvent: { findFirst },
  } as unknown as PrismaService;
  const recommendations = { sync: jest.fn() };
  const service = new ReadinessService(
    prisma,
    recommendations as unknown as RecommendationSyncService,
  );

  beforeEach(() => findFirst.mockReset());

  it('returns READY only when all evidence is complete', async () => {
    findFirst.mockResolvedValue({
      owner: { id: 'owner-id' },
      scheduledStart: new Date('2027-01-01T09:00:00.000Z'),
      scheduledEnd: new Date('2027-01-01T10:00:00.000Z'),
      accessPolicy: { mode: 'REGISTRATION' },
      contentBlocks: [{ id: 'content-id' }],
      mediaAssets: [{ media: { status: 'READY' } }],
      runbookItems: [
        { isCritical: true, status: RunbookStatus.DONE },
        { isCritical: false, status: RunbookStatus.TODO },
      ],
    });

    await expect(
      service.calculate('event-id', 'workspace-id'),
    ).resolves.toMatchObject({
      score: 100,
      status: 'READY',
      blockers: [],
      ruleVersion: '1.0',
    });
  });

  it('keeps hard failures separate from non-blocking score gaps', async () => {
    findFirst.mockResolvedValue({
      owner: { id: 'owner-id' },
      scheduledStart: new Date('2027-01-01T09:00:00.000Z'),
      scheduledEnd: new Date('2027-01-01T10:00:00.000Z'),
      accessPolicy: null,
      contentBlocks: [],
      mediaAssets: [],
      runbookItems: [{ isCritical: true, status: RunbookStatus.IN_PROGRESS }],
    });

    const result = await service.calculate('event-id', 'workspace-id');

    expect(result.score).toBe(20);
    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toEqual([
      'No audience access policy is configured.',
      '1 of 1 critical tasks remain open.',
    ]);
    expect(
      result.criteria.find((criterion) => criterion.key === 'media'),
    ).toMatchObject({
      hardBlocker: false,
      passed: false,
    });
  });

  it('blocks an email-domain policy that has no approved domains', async () => {
    findFirst.mockResolvedValue({
      owner: { id: 'owner-id' },
      scheduledStart: new Date('2027-01-01T09:00:00.000Z'),
      scheduledEnd: new Date('2027-01-01T10:00:00.000Z'),
      accessPolicy: { mode: 'EMAIL_DOMAIN', allowedDomains: [] },
      contentBlocks: [{ id: 'content-id' }],
      mediaAssets: [{ media: { status: 'READY' } }],
      runbookItems: [{ isCritical: true, status: RunbookStatus.DONE }],
    });

    const result = await service.calculate('event-id', 'workspace-id');

    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toContain(
      'Add at least one approved email domain.',
    );
  });

  it('does not reveal whether an event exists outside the workspace', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      service.calculate('event-id', 'other-workspace'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
