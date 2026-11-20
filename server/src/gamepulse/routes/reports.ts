import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { aggregateFeedItemsToStories } from '../storyAggregation.js';
import { normalizeImportance } from '../storyAggregation.js';
import { generateEditorialMarkdown, generateMarkdownReport, type ReportMeta } from '../reports/markdownExport.js';
import {
  editionRange, filterEditorialStories, listDailyEditions, moderateEditionEntry, publishDailyEdition, readDailyEdition,
  readFeatured, shanghaiDate, shiftEditionDate, validEditionDate, EDITION_TIMEZONE
} from '../reports/editorial.js';
import { validateOrThrow } from '../validation.js';
import type { PrismaWhereClause } from '../types.js';
import {
  applyAnalysisFilters,
  applyLowValueNoticeFilter
} from './helpers.js';

const router = Router();
export const adminReportsRouter = Router();

// Retracted or corrected material must not stay in a shared cache.
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

const dateSchema = z.string().refine(validEditionDate, 'date must be a real YYYY-MM-DD calendar date');

const ReportQuerySchema = z.object({
  type: z.enum(['daily', 'weekly']).default('daily'),
  date: dateSchema.optional(),
  weekStart: dateSchema.optional(),
  game: z.string().optional(),
  category: z.string().optional(),
  importance: z.string().optional(),
  visibility: z.string().optional()
});

type ReportQuery = z.infer<typeof ReportQuerySchema>;

// Timezone helpers — all date boundaries are computed in the target timezone
// so that UTC servers (Docker) still produce correct daily/weekly ranges.
function getReportTimezone(): string {
  return process.env.REPORT_TIMEZONE || 'Asia/Shanghai';
}

/** Get today's date string (YYYY-MM-DD) in the target timezone. */
export function todayStrInTz(tz?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || getReportTimezone(),
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const d = parts.find(p => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

/** Get the UTC Date corresponding to midnight (00:00:00.000) of a YYYY-MM-DD in the target timezone. */
export function startOfDayInTz(dateStr: string, tz?: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  let utcGuess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || getReportTimezone(),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  });

  // When the UTC guess falls late in the target timezone's day (e.g., 20:00),
  // the naive subtraction overshoots into the previous day. Advance by 24h and recompute.
  let parts = fmt.formatToParts(utcGuess);
  let localH = Number(parts.find(p => p.type === 'hour')!.value);
  if (localH >= 12) {
    utcGuess = new Date(utcGuess.getTime() + 86400000);
    parts = fmt.formatToParts(utcGuess);
    localH = Number(parts.find(p => p.type === 'hour')!.value);
  }

  const localM = Number(parts.find(p => p.type === 'minute')!.value);
  const localS = Number(parts.find(p => p.type === 'second')!.value);
  const localSeconds = localH * 3600 + localM * 60 + localS;

  return new Date(utcGuess.getTime() - localSeconds * 1000);
}

/** Get the UTC Date corresponding to end-of-day (23:59:59.999) of a YYYY-MM-DD in the target timezone. */
export function endOfDayInTz(dateStr: string, tz?: string): Date {
  return new Date(startOfDayInTz(dateStr, tz).getTime() + 86400000 - 1);
}

function getDateRange(type: string, dateStr?: string, weekStartStr?: string): { start: Date; end: Date; startStr: string; endStr: string } {
  const tz = getReportTimezone();

  if (type === 'weekly') {
    let startStr: string;
    if (weekStartStr) {
      startStr = weekStartStr;
    } else {
      // Default: today minus 6 days in target timezone
      const today = todayStrInTz(tz);
      const [y, m, d] = today.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() - 6);
      startStr = dt.toISOString().slice(0, 10);
    }
    const startDate = startOfDayInTz(startStr, tz);

    // End = start + 6 days
    const [ey, em, ed] = startStr.split('-').map(Number);
    const endDt = new Date(Date.UTC(ey, em - 1, ed));
    endDt.setUTCDate(endDt.getUTCDate() + 6);
    const endStr = endDt.toISOString().slice(0, 10);
    const endDate = endOfDayInTz(endStr, tz);

    return { start: startDate, end: endDate, startStr, endStr };
  }

  // Daily
  const targetStr = dateStr || todayStrInTz(tz);
  return {
    start: startOfDayInTz(targetStr, tz),
    end: endOfDayInTz(targetStr, tz),
    startStr: targetStr,
    endStr: targetStr
  };
}

async function fetchStoriesForReport(query: ReportQuery) {
  const { type, date, weekStart, game, category, importance, visibility } = query;
  const { start, end, startStr, endStr } = getDateRange(type, date, weekStart);

  const where: PrismaWhereClause = {
    hidden: false,
    createdAt: { gte: start, lte: end }
  };

  if (game) where.game = game;

  const catFilter = category || undefined;
  applyAnalysisFilters(where, { category: catFilter, importance: undefined, visibility });
  applyLowValueNoticeFilter(where, visibility);

  const items = await prisma.feedItem.findMany({
    where,
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: 1000,
    include: {
      source: {
        select: {
          id: true,
          name: true,
          type: true,
          game: true,
          isOfficial: true,
          followed: true,
          healthStatus: true
        }
      },
      analysis: true
    }
  });

  let stories = aggregateFeedItemsToStories(items);

  // Apply importance filter
  if (importance) {
    const impSet = new Set(importance.split(',').map(v => normalizeImportance(v)));
    stories = stories.filter(s => impSet.has(s.importance));
  }

  return { stories, dateRange: { start, end }, startStr, endStr };
}

type Selection = Awaited<ReturnType<typeof readDailyEdition>>;
function presentSelection(selection: Selection, query: ReportQuery) {
  const stories = filterEditorialStories(selection.stories, query);
  return {
    ...selection,
    stories,
    meta: {
      type: 'daily' as const,
      dateRange: editionRange(selection.date),
      timezone: EDITION_TIMEZONE,
      game: query.game,
      category: query.category,
      importance: query.importance
    },
    summary: summaryFor(stories)
  };
}

function summaryFor(stories: Array<{ game: string; category: string | null; importance: string }>) {
  return {
    total: stories.length,
    high: stories.filter(s => s.importance === 'high').length,
    medium: stories.filter(s => s.importance === 'medium').length,
    low: stories.filter(s => s.importance === 'low').length,
    games: [...new Set(stories.map(s => s.game))],
    categories: [...new Set(stories.map(s => s.category).filter(Boolean))]
  };
}

/** Live recommendations (not a published issue). */
router.get('/featured', async (req, res) => {
  try {
    const query = validateOrThrow(ReportQuerySchema, { ...req.query, type: 'daily' }, 'featured query');
    res.json(presentSelection(await readFeatured(new Date(), query), query));
  } catch (error) {
    handleIssueError(res, error);
  }
});

/** Read-only archive. A query never generates an issue. */
router.get('/daily', async (req, res) => {
  try {
    const query = validateOrThrow(ReportQuerySchema, { ...req.query, type: 'daily' }, 'daily report');
    const date = query.date || shiftEditionDate(shanghaiDate(), -1);
    res.json(presentSelection(await readDailyEdition(date), query));
  } catch (error) {
    handleIssueError(res, error);
  }
});

router.get('/editions', async (req, res) => {
  try {
    const { before } = validateOrThrow(z.object({ before: dateSchema.optional() }), req.query, 'edition list');
    res.json(await listDailyEditions(before));
  } catch (error) {
    handleIssueError(res, error);
  }
});

const correctionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('withdraw') }),
  z.object({ action: z.literal('correct'), title: z.string().trim().min(1).max(300), summary: z.string().trim().min(1).max(640).nullable() })
]);

// Mounted after requireAdmin on /api/admin/reports.
adminReportsRouter.post('/editions/:date/publish', async (req, res) => {
  try {
    const date = validateOrThrow(dateSchema, req.params.date, 'edition date');
    if (date >= shanghaiDate()) return res.status(400).json({ error: 'Only completed Shanghai days can be published' });
    const status = await publishDailyEdition(date);
    return res.status(status === 'failed' ? 503 : 200).json({ date, status });
  } catch (error) {
    handleIssueError(res, error);
  }
});
adminReportsRouter.patch('/editions/:date/entries/:eventId', async (req, res) => {
  try {
    const date = validateOrThrow(dateSchema, req.params.date, 'edition date');
    const eventId = validateOrThrow(z.string().min(1).max(120), req.params.eventId, 'event id');
    const action = validateOrThrow(correctionSchema, req.body, 'edition correction');
    if (!await moderateEditionEntry(date, eventId, action)) {
      return res.status(404).json({ error: 'Published entry not found or already withdrawn' });
    }
    return res.status(204).end();
  } catch (error) {
    handleIssueError(res, error);
  }
});

function handleIssueError(res: import('express').Response, error: unknown) {
  if (error instanceof Error && error.message.startsWith('Validation failed')) {
    return res.status(400).json({ error: error.message });
  }
  console.error('Editorial report failed:', error);
  return res.status(500).json({ error: 'Failed to fetch or update editorial report' });
}

/**
 * GET /reports/weekly - 获取周报 JSON 数据
 */
router.get('/weekly', async (req, res) => {
  try {
    const query = validateOrThrow(ReportQuerySchema, { ...req.query, type: 'weekly' }, 'weekly report');
    const { stories, dateRange } = await fetchStoriesForReport(query);

    const meta: ReportMeta = {
      type: 'weekly',
      dateRange,
      game: query.game,
      category: query.category,
      importance: query.importance
    };

    res.json({
      meta,
      stories,
      summary: {
        total: stories.length,
        high: stories.filter(s => s.importance === 'high').length,
        medium: stories.filter(s => s.importance === 'medium').length,
        low: stories.filter(s => s.importance === 'low').length,
        games: [...new Set(stories.map(s => s.game))],
        categories: [...new Set(stories.map(s => s.category).filter(Boolean))]
      }
    });
  } catch (error) {
    console.error('Weekly report failed:', error);
    if (error instanceof Error && error.message.startsWith('Validation failed')) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to generate weekly report' });
  }
});

/**
 * GET /reports/export - 导出 Markdown 报告
 */
router.get('/export', async (req, res) => {
  try {
    const query = validateOrThrow(ReportQuerySchema, req.query, 'report export');
    if (query.type === 'daily') {
      const date = query.date || shiftEditionDate(shanghaiDate(), -1);
      const edition = presentSelection(await readDailyEdition(date), query);
      if (edition.status !== 'published' && edition.status !== 'empty') {
        return res.status(409).json({ error: 'The daily edition is not published', date, status: edition.status });
      }
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="acg-pulse-daily-${date}.md"`);
      return res.send(generateEditorialMarkdown(edition));
    }
    const { stories, dateRange, startStr } = await fetchStoriesForReport(query);

    const meta: ReportMeta = {
      type: query.type,
      dateRange,
      game: query.game,
      category: query.category,
      importance: query.importance
    };

    const markdown = generateMarkdownReport(stories, meta);
    const dateLabel = `week-${query.weekStart || startStr}`;
    const filename = `acg-pulse-${query.type}-${dateLabel}.md`;

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(markdown);
  } catch (error) {
    console.error('Report export failed:', error);
    if (error instanceof Error && error.message.startsWith('Validation failed')) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to export report' });
  }
});

export default router;
