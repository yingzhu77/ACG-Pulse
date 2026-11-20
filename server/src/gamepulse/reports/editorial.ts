import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { getMaxFeedItems } from '../config.js';
import { eventPublicWhere, projectEventMembers, syncEvents } from '../services/events.js';
import { isLowValueNotice, normalizeImportance, toPublicFeedItem, type PublicStory } from '../storyAggregation.js';
import { AnalysisCategoryEnum } from '../validation.js';

const DAY = 86_400_000;
const MAX_PUBLICATION_LAG = 2 * DAY;
const MAX_CLOCK_SKEW = 10 * 60_000;
const DAILY_LIMIT = 8;
// Collector is scheduled every 30 minutes. Allow one missed cycle before flagging stale coverage.
const LIVE_SOURCE_STALE_MS = 60 * 60_000;
export const EDITION_TIMEZONE = 'Asia/Shanghai';
const ISSUE_CALENDAR = new Intl.DateTimeFormat('sv-SE', {
  timeZone: EDITION_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
});

export const shanghaiDate = (now = new Date()) => ISSUE_CALENDAR.format(now);
export function validEditionDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(date + 'T00:00:00Z');
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
}
export function shiftEditionDate(date: string, days: number): string {
  if (!validEditionDate(date)) throw new Error('Invalid edition date');
  return new Date(new Date(date + 'T00:00:00Z').getTime() + days * DAY).toISOString().slice(0, 10);
}
export function editionRange(date: string) {
  if (!validEditionDate(date)) throw new Error('Invalid edition date');
  // The project covers modern issues only; Asia/Shanghai is UTC+08:00.
  const start = new Date(date + 'T00:00:00+08:00');
  const end = new Date(start.getTime() + DAY - 1);
  return { start, end };
}

export type SummaryStatus = 'available' | 'insufficient' | 'failed' | 'pending' | 'unavailable';
export type EditionStatus = 'live' | 'failed' | 'pending' | 'published' | 'empty';
export interface EditorialHealth {
  failedSources: number;
  degradedSources: number;
  uncheckedSources: number;
  // Optional for reading editions sealed before freshness was added.
  configuredSources?: number;
  staleSources?: number;
  lastCheckedAt?: string | null;
  lastSuccessAt?: string | null;
  pendingAnalysis: number;
  failedAnalysis: number;
  unavailableAnalysis: number;
}
export interface EditorialMetadata {
  kind: 'new' | 'update';
  publishedAt: string;
  discoveredAt: string;
  selectedAt: string | null;
  summaryStatus: SummaryStatus;
  impact: string | null;
  late: boolean;
  correctedAt?: string;
}
// Use the existing story view shape but store no raw item content or internal analysis metadata.
export type EditorialStory = Omit<PublicStory, 'publishedAt' | 'fetchedAt' | 'createdAt' | 'items' | 'sources'> & {
  publishedAt: string;
  fetchedAt: string;
  createdAt: string;
  items: [];
  sources: Array<Omit<PublicStory['sources'][number], 'publishedAt'> & { publishedAt: string | null }>;
  editorial: EditorialMetadata;
};

const emptyHealth = (): EditorialHealth => ({
  failedSources: 0, degradedSources: 0, uncheckedSources: 0, pendingAnalysis: 0, failedAnalysis: 0, unavailableAnalysis: 0,
  configuredSources: 0, staleSources: 0, lastCheckedAt: null, lastSuccessAt: null
});

const include = {
  source: { select: { id: true, name: true, type: true, game: true, isOfficial: true, followed: true, healthStatus: true } },
  analysis: true
} as const;
type CandidateItem = Prisma.FeedItemGetPayload<{ include: typeof include }>;
type PickedEntry = {
  story: EditorialStory;
  feedItemId: string;
  sourceId: string;
  discoveredAt: Date;
  score: number;
  progress: boolean;
};

const DIRECT_OPERATIONAL_NEWS = /停止运营|终止(?:游戏)?运营|运营终止|停服|关服|无法登录|登录(?:故障|异常)|(?:服务器|服务端)(?:紧急)?(?:故障|异常|维护)|紧急维护|(?:全服|开服)补偿/;
const SPECULATION_OR_COMMENTARY = /[?？]|传闻|网传|据传|疑似|猜测|猜想|是否|会不会|可能|预测|解读|分析|讨论|随便聊|锐评|吐槽|整活|爆料|回顾/;
const OFFICIAL_ANNOUNCEMENT_SOURCES = new Set(['official_site', 'rss', 'rsshub', 'bilibili_video']);
const OCCASION = /生日|抽奖|有奖|投票|贺图|打卡|签到|征集|壁纸|周边|邀稿/;
const substantiveCategories = new Set(['version', 'announcement', 'event', 'character', 'trailer', 'pv']);

function knownPublication(item: CandidateItem): item is CandidateItem & { publishedAt: Date } {
  const ageAtDiscovery = item.createdAt.getTime() - (item.publishedAt?.getTime() ?? -Infinity);
  return !!item.publishedAt && !item.isSourceBackfill
    && ageAtDiscovery <= MAX_PUBLICATION_LAG && ageAtDiscovery >= -MAX_CLOCK_SKEW;
}

function hasSourceBody(item: CandidateItem): boolean {
  const normalize = (text: string) => text.replace(/<[^>]*>|[\s\p{P}\p{S}]+/gu, '');
  const title = normalize(item.title);
  return normalize(item.content).replace(title, '').length >= 24;
}

function usesRulesFallback(item: CandidateItem) {
  return item.analysis?.provider === 'fallback';
}

function hasUsableAnalysis(item: CandidateItem): boolean {
  const analysis = item.analysis;
  return !!analysis && analysis.status === 'completed'
    && !usesRulesFallback(item) && analysis.provider !== 'rules'
    && ['low', 'medium', 'high', 'urgent'].includes(analysis.importance)
    && AnalysisCategoryEnum.safeParse(analysis.category).success;
}

function directOperationalFallback(item: CandidateItem): boolean {
  // Never upgrade a completed, usable judgement based on keywords. Headlines alone
  // only qualify for direct, operational statements from an official publisher.
  return !hasUsableAnalysis(item) && item.source.isOfficial && item.itemKind === 'official_post'
    && OFFICIAL_ANNOUNCEMENT_SOURCES.has(item.source.type)
    && DIRECT_OPERATIONAL_NEWS.test(item.title) && !SPECULATION_OR_COMMENTARY.test(item.title);
}

function editorialView(item: CandidateItem & { publishedAt: Date }, hasPrevious: boolean, start: Date, selectedAt: string | null) {
  if (!item.eventId) return null;
  const raw = toPublicFeedItem(item);
  if (isLowValueNotice(raw) || OCCASION.test(item.title)) return null;
  if (item.url.length > 4_096) return null;
  let sourceUrl: URL;
  try { sourceUrl = new URL(item.url); } catch { return null; }
  if (!['http:', 'https:'].includes(sourceUrl.protocol)) return null;
  const completed = item.analysis?.status === 'completed';
  const headlineBeat = directOperationalFallback(item);
  const importance = raw.analysis?.importance;
  const category = raw.analysis?.category || '';
  const unavailable = usesRulesFallback(item);
  const usableAnalysis = hasUsableAnalysis(item);
  const strongAnalysis = usableAnalysis && (importance === 'high' || (importance === 'medium' && substantiveCategories.has(category)));
  // A known hard-news headline still belongs when the model is down; no synthetic summary/impact.
  if (!strongAnalysis && !headlineBeat) return null;
  const base = projectEventMembers(item.eventId, [item]);
  if (!base) return null;
  const publishDayLag = item.publishedAt < start;
  const summary = usableAnalysis && hasSourceBody(item) ? item.analysis?.summary?.trim().slice(0, 640) || null : null;
  const impact = summary ? item.analysis?.reason?.trim().slice(0, 240) || null : null;
  const summaryStatus = summary ? 'available' : unavailable ? 'unavailable' : completed ? 'insufficient'
    : item.analysis?.status === 'failed' ? 'failed' : 'pending';
  const story: EditorialStory = {
    game: base.game,
    sourceCount: base.sourceCount,
    itemCount: base.itemCount,
    id: item.eventId,
    category: base.category ?? (headlineBeat ? 'announcement' : null),
    importance: strongAnalysis ? base.importance : 'medium',
    summary, reason: impact,
    visibility: 'public',
    canonicalTitle: base.canonicalTitle.slice(0, 300),
    coverUrl: base.coverUrl && base.coverUrl.length <= 2_048 ? base.coverUrl : null,
    publishedAt: item.publishedAt.toISOString(),
    fetchedAt: item.fetchedAt.toISOString(),
    createdAt: item.createdAt.toISOString(),
    items: [],
    sources: base.sources.slice(0, 1).map(source => ({
      ...source, title: source.title.slice(0, 300), sourceName: source.sourceName.slice(0, 160),
      publishedAt: source.publishedAt?.toISOString() ?? null
    })),
    editorial: {
      kind: hasPrevious ? 'update' : 'new',
      publishedAt: item.publishedAt.toISOString(),
      discoveredAt: item.createdAt.toISOString(),
      selectedAt, summaryStatus, impact, late: publishDayLag
    }
  };
  return { story, feedItemId: item.id, sourceId: item.sourceId, discoveredAt: item.createdAt,
    score: (story.importance === 'high' ? 3 : 2) * 10 + Number(headlineBeat) * 2 + Number(Boolean(summary)),
    progress: item.eventProgress } satisfies PickedEntry;
}

async function getSourceCoverage(start: Date, end: Date, live: boolean, game?: string) {
  const sources = await prisma.source.findMany({
    where: { enabled: true, createdAt: { lte: end }, ...(game ? { game: { in: [game, ''] } } : {}) },
    select: { id: true, healthStatus: true, lastCheckedAt: true, lastSuccessAt: true }
  });
  const sourceIds = sources.map(source => source.id);
  const logStart = live ? new Date(start.getTime() - DAY) : start;
  const logs = sourceIds.length ? await prisma.sourceHealthLog.findMany({
    where: { sourceId: { in: sourceIds }, checkedAt: { gte: logStart, lte: end } },
    orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
    select: { sourceId: true, status: true, checkedAt: true }
  }) : [];
  const latestLog = new Map<string, typeof logs[number]>();
  const lastSuccessfulLog = new Map<string, Date>();
  for (const log of logs) {
    if (!latestLog.has(log.sourceId)) latestLog.set(log.sourceId, log);
    if (log.status === 'healthy' && !lastSuccessfulLog.has(log.sourceId)) lastSuccessfulLog.set(log.sourceId, log.checkedAt);
  }

  const withinRange = (time: Date | null): time is Date => !!time && time <= end && (live || time >= start);
  let lastChecked: Date | null = null;
  let lastSuccess: Date | null = null;
  let stale = 0;
  const health = emptyHealth();
  for (const source of sources) {
    const log = latestLog.get(source.id);
    const currentIsLatest = withinRange(source.lastCheckedAt) && (!log || source.lastCheckedAt >= log.checkedAt);
    const checkedAt = currentIsLatest ? source.lastCheckedAt : log?.checkedAt ?? null;
    const status = currentIsLatest ? source.healthStatus : log?.status;
    // A healthy attempt is itself evidence of success, even when a legacy row lacks lastSuccessAt.
    let successfulCheck = withinRange(source.lastSuccessAt) ? source.lastSuccessAt : null;
    for (const timestamp of [lastSuccessfulLog.get(source.id), status === 'healthy' ? checkedAt : null]) {
      if (timestamp && (!successfulCheck || timestamp > successfulCheck)) successfulCheck = timestamp;
    }

    if (checkedAt && (!lastChecked || checkedAt > lastChecked)) lastChecked = checkedAt;
    if (successfulCheck && (!lastSuccess || successfulCheck > lastSuccess)) lastSuccess = successfulCheck;
    // A fresh failed retry does not make cached data current. Failure/degradation and staleness
    // are independent, but each source contributes at most once to the stale count.
    const tooOld = (timestamp: Date | null) => timestamp && end.getTime() - timestamp.getTime() > LIVE_SOURCE_STALE_MS;
    if (live && (tooOld(checkedAt) || tooOld(successfulCheck))) stale++;
    if (status === 'failed') health.failedSources++;
    else if (status === 'degraded') health.degradedSources++;
    else if (status !== 'healthy') health.uncheckedSources++;
  }
  health.configuredSources = sources.length;
  // Freshness is a live operational concern; archived coverage is based on the original issue window.
  health.staleSources = stale;
  health.lastCheckedAt = lastChecked?.toISOString() ?? null;
  health.lastSuccessAt = lastSuccess?.toISOString() ?? null;
  return { health, enabled: sources.length };
}

interface EditorialFilters { game?: string; category?: string; importance?: string }
export function filterEditorialStories<T extends Pick<PublicStory, 'game' | 'category' | 'importance'>>(stories: T[], filters: EditorialFilters): T[] {
  const importance = filters.importance ? new Set(filters.importance.split(',').map(normalizeImportance)) : null;
  return stories.filter(story => (!filters.game || story.game === filters.game)
    && (!filters.category || story.category === filters.category)
    && (!importance || importance.has(story.importance)));
}

async function buildSelection(date: string, now: Date, selectedAt: string | null, filters: EditorialFilters = {}) {
  await syncEvents();
  const { start, end } = editionRange(date);
  const cutoff = new Date(Math.min(now.getTime(), end.getTime()));
  const [rows, coverage] = await Promise.all([
    prisma.feedItem.findMany({
      where: {
        AND: [
          eventPublicWhere,
          { eventId: { not: null }, isSourceBackfill: false, ...(filters.game ? { game: filters.game } : {}) },
          { createdAt: { gte: new Date(start.getTime() - MAX_PUBLICATION_LAG), lte: cutoff } },
          { publishedAt: { gte: new Date(start.getTime() - MAX_PUBLICATION_LAG), lte: cutoff } }
        ]
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: getMaxFeedItems(),
      include
    }),
    getSourceCoverage(start, cutoff, selectedAt === null, filters.game)
  ]);
  const { health, enabled } = coverage;
  const candidates = rows.filter(knownPublication).filter(row => !isLowValueNotice(toPublicFeedItem(row)));
  const eventIds = [...new Set(candidates.flatMap(row => row.eventId ? [row.eventId] : []))];
  const [previous, events] = eventIds.length ? await Promise.all([
    prisma.dailyEditionEntry.findMany({
      where: { eventId: { in: eventIds } },
      select: { eventId: true, feedItemId: true, editionDate: true, discoveredAt: true }
    }),
    prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, createdAt: true } })
  ]) : [[], []];
  const eventFirstSeen = new Map(events.map(event => [event.id, event.createdAt.getTime()]));
  const seenEvidence = new Set(previous.map(item => item.feedItemId));
  const lastEvidenceByEvent = new Map<string, number>();
  for (const item of previous) {
    if (item.editionDate < date) lastEvidenceByEvent.set(item.eventId,
      Math.max(lastEvidenceByEvent.get(item.eventId) ?? -Infinity, item.discoveredAt.getTime()));
  }

  const byEvent = new Map<string, PickedEntry[]>();
  for (const item of candidates) {
    if (!item.eventId || seenEvidence.has(item.id)) continue;
    const previousTime = lastEvidenceByEvent.get(item.eventId);
    if (previousTime !== undefined && item.createdAt.getTime() < previousTime) continue;
    const firstSeen = eventFirstSeen.get(item.eventId);
    // Later mirrors are not progress. On the first day only, a trustworthy
    // corroborating report can replace a weak first headline as the snapshot's evidence.
    if (!item.eventProgress && (previousTime !== undefined || firstSeen === undefined || firstSeen < +start)) continue;
    // A report discovered late belongs to its discovery day. A previously unreported
    // item cleared by analysis only after midnight can enter that next unclosed day.
    const analyzedAt = hasUsableAnalysis(item) ? item.analysis?.analyzedAt : null;
    const readyAt = analyzedAt && analyzedAt > item.createdAt ? analyzedAt : item.createdAt;
    if (readyAt < start || readyAt > cutoff) continue;
    if (item.analysis?.status === 'failed') health.failedAnalysis++;
    else if (usesRulesFallback(item)) health.unavailableAnalysis++;
    else if (item.analysis?.status !== 'completed') health.pendingAnalysis++;
    const isUpdate = previousTime !== undefined || (firstSeen !== undefined && firstSeen < +start);
    const view = editorialView(item, isUpdate, start, selectedAt);
    if (!view) continue;
    const entries = byEvent.get(item.eventId) || [];
    entries.push(view);
    byEvent.set(item.eventId, entries);
  }

  const lineUp: PickedEntry[] = [];
  for (const entries of byEvent.values()) {
    const byDiscovery = (a: PickedEntry, b: PickedEntry) => +b.discoveredAt - +a.discoveredAt || b.score - a.score;
    const progress = entries.filter(entry => entry.progress).sort(byDiscovery)[0];
    const corroboration = entries.filter(entry => !entry.progress && entry.story.summary
      && (!progress || (entry.story.editorial.publishedAt >= progress.story.editorial.publishedAt && !progress.story.summary)))
      .sort((a, b) => b.score - a.score || byDiscovery(a, b))[0];
    if (corroboration || progress) lineUp.push(corroboration || progress);
  }
  const filtered = new Set(filterEditorialStories(lineUp.map(entry => entry.story), filters));
  const selected = lineUp.filter(entry => filtered.has(entry.story)).sort((a, b) =>
    b.score - a.score || +b.discoveredAt - +a.discoveredAt || a.story.id.localeCompare(b.story.id)
  ).slice(0, DAILY_LIMIT);
  return { selected, health, covered: enabled > 0 && !health.failedSources && !health.degradedSources && !health.uncheckedSources };
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

type PublishStatus = 'failed' | 'published' | 'empty';
const publishInFlight = new Map<string, Promise<PublishStatus>>();
let publishTail: Promise<unknown> = Promise.resolve();

export async function publishDailyEdition(date: string, now = new Date()): Promise<PublishStatus> {
  if (!validEditionDate(date) || date >= shanghaiDate(now)) throw new Error('Only completed Shanghai days can be published');
  const active = publishInFlight.get(date);
  if (active) return active;
  // Serialize different dates too, so incomplete retries cannot select the same evidence twice.
  const promise = publishTail.then(() => publish(date, now));
  publishTail = promise.catch(() => {});
  publishInFlight.set(date, promise);
  try { return await promise; }
  finally { if (publishInFlight.get(date) === promise) publishInFlight.delete(date); }
}

async function publish(date: string, now: Date): Promise<PublishStatus> {
  const existing = await prisma.dailyEdition.findUnique({ where: { date } });
  if (existing?.publishedAt) return existing.status === 'empty' ? 'empty' : 'published';

  try {
    const { selected, health, covered } = await buildSelection(date, now, now.toISOString());
    return await prisma.$transaction(async tx => {
      // Recheck visibility after the selection read, inside the publication transaction.
      const visible = selected.length ? await tx.feedItem.findMany({
        where: { AND: [eventPublicWhere, { id: { in: selected.map(entry => entry.feedItemId) } }] },
        select: { id: true }
      }) : [];
      const visibleIds = new Set(visible.map(item => item.id));
      const approved = selected.filter(entry => visibleIds.has(entry.feedItemId));
      const status: PublishStatus = approved.length ? 'published'
        : covered && health.pendingAnalysis === 0 && health.failedAnalysis === 0 && health.unavailableAnalysis === 0 ? 'empty' : 'failed';
      await tx.dailyEdition.upsert({
        where: { date },
        create: { date, status: 'failed', health: json(health) },
        update: {}
      });
      const update = await tx.dailyEdition.updateMany({
        where: { date, publishedAt: null },
        data: { status, health: json(health), publishedAt: status === 'failed' ? null : now }
      });
      if (!update.count) {
        const current = await tx.dailyEdition.findUniqueOrThrow({ where: { date } });
        return current.status === 'empty' ? 'empty' : 'published';
      }
      if (approved.length) await tx.dailyEditionEntry.createMany({
        data: approved.map((entry, rank) => ({
          editionDate: date, eventId: entry.story.id, rank, feedItemId: entry.feedItemId,
          sourceId: entry.sourceId, discoveredAt: entry.discoveredAt, story: json(entry.story)
        }))
      });
      return status;
    });
  } catch (error) {
    console.error('[ACG Pulse] Daily edition publication failed', date, error instanceof Error ? error.message : String(error));
    const current = await prisma.dailyEdition.upsert({
      where: { date },
      create: { date, status: 'failed', health: json(emptyHealth()) },
      update: {}
    });
    return current.status === 'empty' ? 'empty' : current.status === 'published' ? 'published' : 'failed';
  }
}

export async function readDailyEdition(date: string) {
  const value = await prisma.dailyEdition.findUnique({
    where: { date },
    include: { entries: { orderBy: { rank: 'asc' } } }
  });
  const visible = value?.entries.filter(entry => !entry.withdrawnAt) ?? [];
  const stories = visible.map(entry => {
    const story = entry.story as unknown as EditorialStory;
    const correction = entry.correction as Correction | null;
    if (!correction || !entry.correctedAt) return story;
    return {
      ...story,
      canonicalTitle: correction.title,
      summary: correction.summary,
      reason: null,
      sources: story.sources.map(source => ({ ...source, title: source.sourceName })),
      editorial: {
        ...story.editorial,
        impact: null,
        summaryStatus: correction.summary ? 'available' as const : 'insufficient' as const,
        correctedAt: entry.correctedAt.toISOString()
      }
    };
  });
  return {
    date,
    status: (value?.status ?? 'pending') as EditionStatus,
    publishedAt: value?.publishedAt?.toISOString() ?? null,
    health: value ? value.health as unknown as EditorialHealth : emptyHealth(),
    withdrawnCount: (value?.entries.length ?? 0) - visible.length,
    stories
  };
}

export async function readFeatured(now = new Date(), filters: EditorialFilters = {}) {
  const date = shanghaiDate(now);
  const { selected, health } = await buildSelection(date, now, null, filters);
  return { date, status: 'live' as const, publishedAt: null, health, withdrawnCount: 0, stories: selected.map(entry => entry.story) };
}

export async function listDailyEditions(before?: string) {
  const rows = await prisma.dailyEdition.findMany({
    where: before ? { date: { lt: before } } : {},
    orderBy: { date: 'desc' }, take: 31,
    select: { date: true, status: true, publishedAt: true }
  });
  return { data: rows.slice(0, 30), nextBefore: rows.length > 30 ? rows[29].date : null };
}

type Correction = { title: string; summary: string | null };
export async function moderateEditionEntry(
  date: string, eventId: string, action: { action: 'withdraw' } | { action: 'correct'; title: string; summary: string | null }, now = new Date()
) {
  const data = action.action === 'withdraw'
    ? { withdrawnAt: now }
    : { correction: json({ title: action.title, summary: action.summary }), correctedAt: now };
  return (await prisma.dailyEditionEntry.updateMany({
    where: { editionDate: date, eventId, withdrawnAt: null }, data
  })).count > 0;
}
