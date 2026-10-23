import type { Server } from 'socket.io';
import type { Prisma } from '@prisma/client';
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
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const UNEXPECTED_ERROR_RETRY_MS = 30_000;

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
  await createAnalysisTaskIfAbsent(feedItemId);
  wakeAnalysisQueue(currentIo);
}

export function wakeAnalysisQueue(io?: Server): void {
  void processAnalysisQueue(io).catch(error => {
    console.error('[AnalysisQueue] Worker failed:', error);
  });
}

export async function reanalyzeItem(feedItemId: string, io?: Server): Promise<void> {
  currentIo = io || currentIo;
  await createAnalysisTaskIfAbsent(feedItemId);
  wakeAnalysisQueue(currentIo);
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

  let created = 0;
  for (const item of items) {
    if (openFeedItemIds.has(item.id)) continue;
    if (await createAnalysisTaskIfAbsent(item.id)) created++;
  }

  if (created > 0) wakeAnalysisQueue(currentIo);
  return created;
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
      await backfillAnalysisTaskDedupeKeys();
      await recoverStaleRunningTasks();
      await reconcileMissingAnalysisTasks();
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
  let finishedNormally = false;

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
    finishedNormally = true;
  } finally {
    processing = false;
    try {
      if (finishedNormally) {
        await scheduleNextRun(currentIo);
      } else {
        // Provider failures have explicit bounded task retries. An unexpected database
        // failure stays visible, but pending tasks must still be picked up later.
        scheduleRecoveryRun();
      }
    } catch (error) {
      console.error('[AnalysisQueue] Failed to schedule the next run; retrying later:', error);
      scheduleRecoveryRun();
    }
  }
}

function scheduleRecoveryRun(): void {
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    wakeAnalysisQueue(currentIo);
  }, UNEXPECTED_ERROR_RETRY_MS);
  retryTimer.unref?.();
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
  await resetTaskForRetry(taskId);
  wakeAnalysisQueue(currentIo);
}

async function resetTaskForRetry(taskId: string): Promise<void> {
  const task = await prisma.analysisTask.findUnique({
    where: { id: taskId },
    select: { feedItemId: true }
  });
  if (!task) throw new Error('Analysis task not found');

  await prisma.analysisTask.update({
    where: { id: taskId },
    data: {
      dedupeKey: task.feedItemId,
      status: 'pending',
      lastError: null,
      nextRunAt: new Date(),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      durationMs: null
    }
  });
}

export async function retryFailedAnalysisTasks(io?: Server): Promise<number> {
  currentIo = io || currentIo;
  const failedTasks = await prisma.analysisTask.findMany({
    where: { status: 'failed' },
    select: { id: true }
  });

  let retried = 0;
  for (const task of failedTasks) {
    try {
      await resetTaskForRetry(task.id);
      retried++;
    } catch (error) {
      if (!isPrismaUniqueConflict(error)) throw error;
    }
  }

  wakeAnalysisQueue(currentIo);
  return retried;
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

  return prisma.analysisTask.findUnique({
    where: { id: candidate.id },
    select: { id: true, feedItemId: true }
  });
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
  const completed = await prisma.$transaction(async tx => {
    const latest = await tx.feedItem.findUnique({ where: { id: feedItemId }, select: { contentHash: true } });
    if (!latest) return false;

    // This check and releasing dedupeKey must be atomic with respect to collection.
    // Otherwise an update after result persistence can still lose its follow-up task.
    if (result.status === 'superseded' || latest.contentHash !== item.contentHash) {
      await tx.analysisTask.update({
        where: { id: taskId },
        data: {
          status: 'pending',
          nextRunAt: new Date(),
          startedAt: null,
          completedAt: null,
          failedAt: null
        }
      });
      return false;
    }

    if (result.status === 'failed') {
      await markTaskFailed(taskId, result.error || 'Unknown AI analysis error', started, tx);
      return false;
    }

    await tx.analysisTask.update({
      where: { id: taskId },
      data: {
        dedupeKey: null,
        status: 'completed',
        provider: result.provider,
        model: result.model,
        lastError: null,
        durationMs: Date.now() - started,
        completedAt: new Date()
      }
    });
    return true;
  });

  if (completed) await notifyAnalyzedItem(feedItemId, item.contentHash, io);
}

async function markTaskFailed(
  taskId: string,
  message: string,
  started: number,
  db: Pick<Prisma.TransactionClient, 'analysisTask'> = prisma
): Promise<void> {
  const task = await db.analysisTask.findUnique({
    where: { id: taskId },
    select: { retryCount: true, maxRetries: true }
  });
  const retryCount = (task?.retryCount || 0) + 1;
  const maxRetries = task?.maxRetries || getMaxRetries();

  await db.analysisTask.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      retryCount,
      lastError: message.slice(0, 500),
      durationMs: Date.now() - started,
      failedAt: new Date(),
      dedupeKey: retryCount < maxRetries ? undefined : null,
      nextRunAt: retryCount < maxRetries
        ? new Date(Date.now() + retryDelayMs(retryCount))
        : TERMINAL_NEXT_RUN_AT
    }
  });
}

async function notifyAnalyzedItem(feedItemId: string, expectedContentHash: string, io?: Server): Promise<void> {
  const withAnalysis = await prisma.feedItem.findUnique({
    where: { id: feedItemId },
    include: { source: true, analysis: true }
  });
  if (!withAnalysis || withAnalysis.contentHash !== expectedContentHash || withAnalysis.analysis?.status !== 'completed') return;

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
      // Terminal tasks are parked at year 9999; scheduling them overflows setTimeout and spins.
      nextRunAt: { lt: TERMINAL_NEXT_RUN_AT },
      OR: [
        { status: 'pending' },
        { status: 'failed', retryCount: { lt: getMaxRetries() } }
      ]
    },
    orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'asc' }],
    select: { nextRunAt: true }
  });

  if (!nextTask) return;

  const delay = Math.min(
    Math.max(0, nextTask.nextRunAt.getTime() - Date.now()),
    MAX_TIMER_DELAY_MS
  );
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    wakeAnalysisQueue(io);
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

export async function backfillAnalysisTaskDedupeKeysForTest(): Promise<void> {
  await backfillAnalysisTaskDedupeKeys();
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

async function reconcileMissingAnalysisTasks(): Promise<void> {
  const items = await prisma.feedItem.findMany({
    where: {
      analysisTasks: { none: {} },
      OR: [{ analysis: null }, { analysis: { status: 'pending' } }]
    },
    select: { id: true }
  });
  for (const item of items) await createAnalysisTaskIfAbsent(item.id);
}

async function backfillAnalysisTaskDedupeKeys(): Promise<void> {
  const candidates = await prisma.analysisTask.findMany({
    where: {
      dedupeKey: null,
      OR: [
        { status: { in: ['pending', 'running'] } },
        { status: 'failed', nextRunAt: { lt: TERMINAL_NEXT_RUN_AT } }
      ]
    },
    orderBy: [{ createdAt: 'asc' }],
    select: { id: true, feedItemId: true }
  });
  const seenFeedItems = new Set<string>();

  for (const task of candidates) {
    if (seenFeedItems.has(task.feedItemId)) {
      await markDuplicateOpenTaskSuperseded(task.id);
      continue;
    }

    try {
      await prisma.analysisTask.update({
        where: { id: task.id },
        data: { dedupeKey: task.feedItemId }
      });
      seenFeedItems.add(task.feedItemId);
    } catch (error) {
      if (!isPrismaUniqueConflict(error)) throw error;
      seenFeedItems.add(task.feedItemId);
      await markDuplicateOpenTaskSuperseded(task.id);
    }
  }
}

async function markDuplicateOpenTaskSuperseded(taskId: string): Promise<void> {
  const maxRetries = getMaxRetries();
  await prisma.analysisTask.update({
    where: { id: taskId },
    data: {
      dedupeKey: null,
      status: 'failed',
      retryCount: maxRetries,
      maxRetries,
      lastError: 'Duplicate open analysis task superseded during dedupe backfill',
      failedAt: new Date(),
      nextRunAt: TERMINAL_NEXT_RUN_AT
    }
  });
}

export async function createAnalysisTaskIfAbsent(
  feedItemId: string,
  db: Pick<Prisma.TransactionClient, 'analysisTask'> = prisma
): Promise<boolean> {
  try {
    await db.analysisTask.create({
      data: {
        feedItemId,
        dedupeKey: feedItemId,
        status: 'pending',
        maxRetries: getMaxRetries(),
        nextRunAt: new Date()
      }
    });
    return true;
  } catch (error) {
    if (isPrismaUniqueConflict(error)) return false;
    throw error;
  }
}

function isPrismaUniqueConflict(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002'
  );
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
