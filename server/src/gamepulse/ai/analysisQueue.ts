import type { Server } from 'socket.io';
import { prisma } from '../../db.js';
import { sendFeedItemEmail } from '../../services/email.js';
import { ensureAnalysis } from './analyzer.js';
import {
  getCompletedAnalysisTaskRetentionDays,
  getFailedAnalysisTaskRetentionDays
} from '../config.js';

const DEFAULT_ANALYSIS_BATCH_DELAY_MS = 5000;
const DEFAULT_MAX_RETRIES = 3;
const TERMINAL_NEXT_RUN_AT = new Date('9999-12-31T00:00:00.000Z');

let processing = false;
let currentIo: Server | undefined;
let retryTimer: NodeJS.Timeout | undefined;
let cleanupSnapshot = {
  lastRunAt: null as string | null,
  completedDeleted: 0,
  failedDeleted: 0
};

export async function enqueueAnalysisTask(feedItemId: string, io?: Server): Promise<void> {
  currentIo = io || currentIo;
  const existingOpenTask = await prisma.analysisTask.findFirst({
    where: {
      feedItemId,
      status: { in: ['pending', 'running'] }
    },
    select: { id: true }
  });

  if (!existingOpenTask) {
    await prisma.analysisTask.create({
      data: {
        feedItemId,
        status: 'pending',
        maxRetries: getMaxRetries(),
        nextRunAt: new Date()
      }
    });
  }

  void processAnalysisQueue(currentIo);
}

export async function reanalyzeItem(feedItemId: string, io?: Server): Promise<void> {
  currentIo = io || currentIo;
  const existingOpenTask = await prisma.analysisTask.findFirst({
    where: {
      feedItemId,
      status: { in: ['pending', 'running'] }
    },
    select: { id: true }
  });

  if (!existingOpenTask) {
    await prisma.analysisTask.create({
      data: {
        feedItemId,
        status: 'pending',
        maxRetries: getMaxRetries(),
        nextRunAt: new Date()
      }
    });
  }
  void processAnalysisQueue(currentIo);
}

export async function reanalyzeAll(limit: number, io?: Server): Promise<number> {
  currentIo = io || currentIo;
  const items = await prisma.feedItem.findMany({
    where: { hidden: false },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  if (items.length === 0) return 0;
  const itemIds = items.map(item => item.id);
  const existingOpenTasks = await prisma.analysisTask.findMany({
    where: {
      feedItemId: { in: itemIds },
      status: { in: ['pending', 'running'] }
    },
    select: { feedItemId: true }
  });
  const openFeedItemIds = new Set(existingOpenTasks.map(task => task.feedItemId));

  const taskData = items.filter(item => !openFeedItemIds.has(item.id)).map(item => ({
    feedItemId: item.id,
    status: 'pending' as const,
    maxRetries: getMaxRetries(),
    nextRunAt: new Date()
  }));

  if (taskData.length === 0) return 0;
  await prisma.analysisTask.createMany({ data: taskData });
  void processAnalysisQueue(currentIo);
  return taskData.length;
}

export function startAnalysisQueueWorker(io: Server): void {
  currentIo = io;
  void (async () => {
    try {
      await cleanupAnalysisTaskHistory();
    } catch (error) {
      console.error('[AnalysisQueue] History cleanup failed:', error);
    }
    try {
      await recoverStaleRunningTasks();
      await processAnalysisQueue(io);
    } catch (error) {
      console.error('[AnalysisQueue] Worker startup failed:', error);
    }
  })();
}

export async function cleanupAnalysisTaskHistory(now = new Date()) {
  const completedRetentionDays = getCompletedAnalysisTaskRetentionDays();
  const failedRetentionDays = getFailedAnalysisTaskRetentionDays();
  const completedCutoff = new Date(now.getTime() - completedRetentionDays * 24 * 60 * 60 * 1000);
  const failedCutoff = new Date(now.getTime() - failedRetentionDays * 24 * 60 * 60 * 1000);

  const completed = await prisma.analysisTask.deleteMany({
    where: { status: 'completed', completedAt: { lt: completedCutoff } }
  });
  const failed = await prisma.analysisTask.deleteMany({
    where: {
      status: 'failed',
      failedAt: { lt: failedCutoff },
      nextRunAt: { gte: TERMINAL_NEXT_RUN_AT }
    }
  });

  cleanupSnapshot = {
    lastRunAt: now.toISOString(),
    completedDeleted: completed.count,
    failedDeleted: failed.count
  };
  if (completed.count > 0 || failed.count > 0) {
    console.log(
      `[AnalysisQueue] Cleaned ${completed.count} completed and ${failed.count} failed historical tasks`
    );
  }
  return cleanupSnapshot;
}

export function getAnalysisTaskCleanupSnapshot() {
  return {
    ...cleanupSnapshot,
    completedRetentionDays: getCompletedAnalysisTaskRetentionDays(),
    failedRetentionDays: getFailedAnalysisTaskRetentionDays()
  };
}

export async function processAnalysisQueue(io?: Server): Promise<void> {
  currentIo = io || currentIo;
  if (processing) return;
  processing = true;
  clearRetryTimer();

  try {
    while (true) {
      const task = await claimNextTask();
      if (!task) break;

      await runTask(task.id, task.feedItemId, currentIo);

      const hasMore = await hasRunnableTask();
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, getBatchDelayMs()));
      }
    }
  } finally {
    processing = false;
    await scheduleNextRun(currentIo);
  }
}

export async function getAnalysisQueueOverview() {
  const [counts, recentTasks] = await Promise.all([
    prisma.analysisTask.groupBy({
      by: ['status'],
      _count: { status: true }
    }),
    prisma.analysisTask.findMany({
      orderBy: [{ updatedAt: 'desc' }],
      take: 20,
      include: {
        feedItem: {
          select: {
            id: true,
            title: true,
            game: true,
            createdAt: true,
            source: {
              select: {
                name: true
              }
            }
          }
        }
      }
    })
  ]);

  return {
    counts: Object.fromEntries(counts.map(item => [item.status, item._count.status])),
    processing,
    recentTasks
  };
}

export async function retryAnalysisTask(taskId: string, io?: Server): Promise<void> {
  currentIo = io || currentIo;
  await prisma.analysisTask.update({
    where: { id: taskId },
    data: {
      status: 'pending',
      lastError: null,
      nextRunAt: new Date(),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      durationMs: null
    }
  });
  void processAnalysisQueue(currentIo);
}

export async function retryFailedAnalysisTasks(io?: Server): Promise<number> {
  currentIo = io || currentIo;
  const result = await prisma.analysisTask.updateMany({
    where: { status: 'failed' },
    data: {
      status: 'pending',
      lastError: null,
      nextRunAt: new Date(),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      durationMs: null
    }
  });
  void processAnalysisQueue(currentIo);
  return result.count;
}

async function claimNextTask(): Promise<{ id: string; feedItemId: string } | null> {
  const now = new Date();
  const maxRetries = getMaxRetries();

  // Find the best candidate, then atomically claim it with a conditional UPDATE.
  const candidate = await prisma.analysisTask.findFirst({
    where: {
      OR: [
        { status: 'pending', nextRunAt: { lte: now } },
        { status: 'failed', nextRunAt: { lte: now }, retryCount: { lt: maxRetries } }
      ]
    },
    orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true }
  });

  if (!candidate) return null;

  // Atomic claim: only succeeds if the task is still in a claimable state.
  // Prevents concurrent workers from double-claiming the same task.
  try {
    const claimed = await prisma.analysisTask.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: 'pending' },
          { status: 'failed', retryCount: { lt: maxRetries } }
        ]
      },
      data: {
        status: 'running',
        startedAt: now,
        completedAt: null,
        failedAt: null
      }
    });

    if (claimed.count === 0) return null;

    const task = await prisma.analysisTask.findUnique({
      where: { id: candidate.id },
      select: { id: true, feedItemId: true }
    });
    return task;
  } catch {
    return null;
  }
}

async function runTask(taskId: string, feedItemId: string, io?: Server): Promise<void> {
  const started = Date.now();
  const item = await prisma.feedItem.findUnique({
    where: { id: feedItemId },
    include: { source: true }
  });

  if (!item) {
    await markTaskFailed(taskId, 'Feed item no longer exists', started);
    return;
  }

  const result = await ensureAnalysis(item, { force: true });
  if (result.status === 'failed') {
    await markTaskFailed(taskId, result.error || 'Unknown AI analysis error', started);
    return;
  }

  await prisma.analysisTask.update({
    where: { id: taskId },
    data: {
      status: 'completed',
      provider: result.provider,
      model: result.model,
      lastError: null,
      durationMs: Date.now() - started,
      completedAt: new Date()
    }
  });

  await notifyAnalyzedItem(feedItemId, io);
}

async function markTaskFailed(taskId: string, message: string, started: number): Promise<void> {
  const task = await prisma.analysisTask.findUnique({
    where: { id: taskId },
    select: { retryCount: true, maxRetries: true }
  });
  const retryCount = (task?.retryCount || 0) + 1;
  const maxRetries = task?.maxRetries || getMaxRetries();

  await prisma.analysisTask.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      retryCount,
      lastError: message.slice(0, 500),
      durationMs: Date.now() - started,
      failedAt: new Date(),
      nextRunAt: retryCount < maxRetries
        ? new Date(Date.now() + retryDelayMs(retryCount))
        : TERMINAL_NEXT_RUN_AT
    }
  });
}

async function notifyAnalyzedItem(feedItemId: string, io?: Server): Promise<void> {
  const withAnalysis = await prisma.feedItem.findUnique({
    where: { id: feedItemId },
    include: { source: true, analysis: true }
  });
  if (!withAnalysis) return;

  io?.to(`game:${withAnalysis.game}`).emit('item:analyzed', withAnalysis);
  io?.emit('notification', {
    type: 'analysis',
    title: withAnalysis.title,
    content: withAnalysis.analysis?.summary || withAnalysis.content.slice(0, 120),
    feedItemId: withAnalysis.id,
    importance: withAnalysis.analysis?.importance || 'low'
  });

  if (['high', 'urgent'].includes(withAnalysis.analysis?.importance || '')) {
    await sendFeedItemEmail(withAnalysis);
  }
}

async function hasRunnableTask(): Promise<boolean> {
  const now = new Date();
  const count = await prisma.analysisTask.count({
    where: {
      OR: [
        { status: 'pending', nextRunAt: { lte: now } },
        { status: 'failed', nextRunAt: { lte: now }, retryCount: { lt: getMaxRetries() } }
      ]
    }
  });
  return count > 0;
}

async function scheduleNextRun(io?: Server): Promise<void> {
  const nextTask = await prisma.analysisTask.findFirst({
    where: {
      OR: [
        { status: 'pending' },
        { status: 'failed', retryCount: { lt: getMaxRetries() } }
      ]
    },
    orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'asc' }],
    select: { nextRunAt: true }
  });

  if (!nextTask) return;

  const delay = Math.max(0, nextTask.nextRunAt.getTime() - Date.now());
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void processAnalysisQueue(io);
  }, delay);
  retryTimer.unref?.();
}

function clearRetryTimer(): void {
  if (!retryTimer) return;
  clearTimeout(retryTimer);
  retryTimer = undefined;
}

export function clearRetryTimerForTest(): void {
  clearRetryTimer();
}

async function recoverStaleRunningTasks(): Promise<void> {
  await prisma.analysisTask.updateMany({
    where: { status: 'running' },
    data: {
      status: 'pending',
      startedAt: null,
      nextRunAt: new Date()
    }
  });
}

function getMaxRetries(): number {
  const parsed = Number(process.env.ANALYSIS_TASK_MAX_RETRIES);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 10) : DEFAULT_MAX_RETRIES;
}

function getBatchDelayMs(): number {
  const parsed = Number(process.env.ANALYSIS_BATCH_DELAY_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_ANALYSIS_BATCH_DELAY_MS;
}

function retryDelayMs(retryCount: number): number {
  return Math.min(60_000, 5_000 * 2 ** Math.max(0, retryCount - 1));
}
