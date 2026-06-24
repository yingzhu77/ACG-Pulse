import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../db.js';
import { getMaxFeedItems } from '../config.js';
import { getApiMetricsSnapshot } from './apiMetrics.js';
import type { OperationalMetrics, OperationalStatus } from './types.js';
import { getAnalysisTaskCleanupSnapshot } from '../ai/analysisQueue.js';

const COMMUNITY_WARNING_COUNT = 1000;
const COMMUNITY_CRITICAL_COUNT = 2500;
const HIDDEN_WARNING_COUNT = 500;
const DATABASE_WARNING_BYTES = 100 * 1024 * 1024;
const DATABASE_CRITICAL_BYTES = 500 * 1024 * 1024;
const WAL_WARNING_BYTES = 64 * 1024 * 1024;
const WAL_CRITICAL_BYTES = 256 * 1024 * 1024;
const OPEN_QUEUE_WARNING = 100;
const OPEN_QUEUE_CRITICAL = 500;
const OPEN_QUEUE_WARNING_AGE_MS = 30 * 60 * 1000;
const OPEN_QUEUE_CRITICAL_AGE_MS = 2 * 60 * 60 * 1000;

function highestStatus(statuses: OperationalStatus[]): OperationalStatus {
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('warning')) return 'warning';
  return 'healthy';
}

function thresholdStatus(value: number, warning: number, critical: number): OperationalStatus {
  if (value >= critical) return 'critical';
  if (value >= warning) return 'warning';
  return 'healthy';
}

function resolveDatabasePath(): string | null {
  const databaseUrl = process.env.DATABASE_URL || '';
  if (!databaseUrl.startsWith('file:')) return null;
  const filePath = databaseUrl.slice(5).split('?')[0];
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), 'prisma', filePath);
}

async function fileSize(filePath: string | null): Promise<number> {
  if (!filePath) return 0;
  try {
    return (await fs.stat(filePath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

export async function getOperationalMetrics(): Promise<OperationalMetrics> {
  const databasePath = resolveDatabasePath();
  const communityCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const [
    visibleFeed,
    hiddenFeed,
    communityTotal,
    staleCommunity,
    healthLogs,
    openQueue,
    failedQueue,
    oldestOpenTask,
    databaseBytes,
    walBytes,
    shmBytes,
    pageCountRows,
    pageSizeRows,
    freePageRows,
  ] = await Promise.all([
    prisma.feedItem.count({ where: { hidden: false } }),
    prisma.feedItem.count({ where: { hidden: true } }),
    prisma.communityTopic.count(),
    prisma.communityTopic.count({ where: { lastSeenAt: { lt: communityCutoff } } }),
    prisma.sourceHealthLog.count(),
    prisma.analysisTask.count({ where: { status: { in: ['pending', 'running'] } } }),
    prisma.analysisTask.count({ where: { status: 'failed' } }),
    prisma.analysisTask.findFirst({
      where: { status: { in: ['pending', 'running'] } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    fileSize(databasePath),
    fileSize(databasePath ? `${databasePath}-wal` : null),
    fileSize(databasePath ? `${databasePath}-shm` : null),
    prisma.$queryRawUnsafe<Array<{ page_count: bigint }>>('PRAGMA page_count'),
    prisma.$queryRawUnsafe<Array<{ page_size: bigint }>>('PRAGMA page_size'),
    prisma.$queryRawUnsafe<Array<{ freelist_count: bigint }>>('PRAGMA freelist_count'),
  ]);

  const maxFeedItems = getMaxFeedItems();
  const feedUsagePercent = Math.round((visibleFeed / maxFeedItems) * 1000) / 10;
  const feedStatus: OperationalStatus = visibleFeed > maxFeedItems
    ? 'critical'
    : hiddenFeed >= HIDDEN_WARNING_COUNT ? 'warning' : 'healthy';
  const communityStatus = thresholdStatus(communityTotal, COMMUNITY_WARNING_COUNT, COMMUNITY_CRITICAL_COUNT);
  const oldestOpenAgeMs = oldestOpenTask ? Date.now() - oldestOpenTask.createdAt.getTime() : 0;
  const queueStatus = highestStatus([
    thresholdStatus(openQueue, OPEN_QUEUE_WARNING, OPEN_QUEUE_CRITICAL),
    thresholdStatus(oldestOpenAgeMs, OPEN_QUEUE_WARNING_AGE_MS, OPEN_QUEUE_CRITICAL_AGE_MS),
  ]);
  const storageStatus = highestStatus([
    thresholdStatus(databaseBytes, DATABASE_WARNING_BYTES, DATABASE_CRITICAL_BYTES),
    thresholdStatus(walBytes, WAL_WARNING_BYTES, WAL_CRITICAL_BYTES),
  ]);
  const api = getApiMetricsSnapshot();
  const pageCount = Number(pageCountRows[0]?.page_count || 0);
  const pageSize = Number(pageSizeRows[0]?.page_size || 0);
  const freePages = Number(freePageRows[0]?.freelist_count || 0);
  const historyCleanup = getAnalysisTaskCleanupSnapshot();

  const capacityStatuses = [feedStatus, communityStatus, queueStatus];
  if (staleCommunity > 0 || failedQueue > 0) capacityStatuses.push('warning');

  return {
    generatedAt: new Date().toISOString(),
    status: highestStatus([storageStatus, api.status, ...capacityStatuses]),
    storage: {
      databaseBytes,
      walBytes,
      shmBytes,
      totalBytes: databaseBytes + walBytes + shmBytes,
      reusableBytes: freePages * pageSize,
      status: storageStatus,
    },
    capacity: {
      feed: {
        visible: visibleFeed,
        hidden: hiddenFeed,
        limit: maxFeedItems,
        usagePercent: feedUsagePercent,
        status: feedStatus,
      },
      community: {
        total: communityTotal,
        stale: staleCommunity,
        status: staleCommunity > 0 ? highestStatus([communityStatus, 'warning']) : communityStatus,
      },
      healthLogs,
      analysisQueue: {
        open: openQueue,
        failed: failedQueue,
        oldestOpenAt: oldestOpenTask?.createdAt.toISOString() || null,
        status: failedQueue > 0 ? highestStatus([queueStatus, 'warning']) : queueStatus,
        historyCleanup
      },
    },
    api,
  };
}
