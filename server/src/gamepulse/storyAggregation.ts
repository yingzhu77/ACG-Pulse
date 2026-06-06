import { contentHash, safeJson } from './utils.js';
import type { FeedItemWithRelations, AnalysisRelation } from './types.js';

type PublicImportance = 'low' | 'medium' | 'high';
type PublicVisibility = 'public' | 'muted';

export interface PublicFeedItem {
  id: string;
  sourceId: string;
  externalId: string | null;
  itemKind: string;
  game: string;
  title: string;
  content: string;
  url: string;
  authorName: string | null;
  authorUrl: string | null;
  coverUrl: string | null;
  sourceType: string;
  hidden: boolean;
  publishedAt: Date | null;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  source: {
    id: string;
    name: string;
    type: string;
    game: string;
    isOfficial: boolean;
    followed: boolean;
    healthStatus: string;
  };
  analysis: {
    id: string;
    status: string;
    category: string | null;
    importance: PublicImportance;
    visibility: PublicVisibility | 'hidden';
    confidence: number;
    summary: string | null;
    reason: string | null;
    dedupKeywords: string[];
    provider: string | null;
    model: string | null;
    error: string | null;
    analyzedAt: Date | null;
  } | null;
}

export interface PublicStory {
  id: string;
  canonicalTitle: string;
  game: string;
  category: string | null;
  importance: PublicImportance;
  visibility: PublicVisibility;
  summary: string | null;
  reason: string | null;
  coverUrl: string | null;
  publishedAt: Date | null;
  fetchedAt: Date;
  createdAt: Date;
  sourceCount: number;
  itemCount: number;
  sources: Array<{
    itemId: string;
    sourceId: string;
    sourceName: string;
    sourceType: string;
    isOfficial: boolean;
    url: string;
    title: string;
    publishedAt: Date | null;
  }>;
  items: PublicFeedItem[];
}

interface StoryDraft {
  signature: string;
  normalizedTitle: string;
  keywords: Set<string>;
  items: PublicFeedItem[];
}

const importanceRank: Record<PublicImportance, number> = {
  low: 1,
  medium: 2,
  high: 3
};

const LOW_IMPORTANCE_PATTERNS = [
  /话题[：:]/,
  /主题[：:]/,
  /生日/,
  /投票/,
  /打卡/,
  /征集/,
  /转发抽奖/,
  /分享活动/,
  /社区活动/
];

function downgradeImportance(importance: PublicImportance, item: { title: string; content: string; analysis?: { category?: string | null } | null }): PublicImportance {
  if (importance === 'low') return 'low';
  const text = `${item.title}\n${item.content}`;
  if (LOW_IMPORTANCE_PATTERNS.some(p => p.test(text))) return 'low';
  if (item.analysis?.category === 'community' && /生日|贺图|庆生/.test(text)) return 'low';
  return importance;
}

export function toPublicFeedItem(item: FeedItemWithRelations): PublicFeedItem {
  const analysis: PublicFeedItem['analysis'] = item.analysis
    ? {
        id: item.analysis.id,
        status: item.analysis.status,
        category: item.analysis.category,
        importance: normalizeImportance(item.analysis.importance),
        visibility: normalizeVisibility(item.analysis.visibility),
        confidence: item.analysis.confidence,
        summary: item.analysis.summary,
        reason: item.analysis.reason,
        dedupKeywords: normalizeDedupKeywords(item.analysis.dedupKeywords),
        provider: item.analysis.provider,
        model: item.analysis.model,
        error: item.analysis.error,
        analyzedAt: item.analysis.analyzedAt
      }
    : null;
  const base: PublicFeedItem = {
    id: item.id,
    sourceId: item.sourceId,
    externalId: item.externalId,
    itemKind: item.itemKind,
    game: item.game,
    title: item.title,
    content: item.content,
    url: item.url,
    authorName: item.authorName,
    authorUrl: item.authorUrl,
    coverUrl: item.coverUrl,
    sourceType: item.sourceType,
    hidden: item.hidden,
    publishedAt: item.publishedAt,
    fetchedAt: item.fetchedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    source: {
      id: item.source.id,
      name: item.source.name,
      type: item.source.type,
      game: item.source.game,
      isOfficial: item.source.isOfficial,
      followed: item.source.followed ?? false,
      healthStatus: item.source.healthStatus
    },
    analysis
  };
  if (base.analysis) {
    base.analysis.importance = downgradeImportance(base.analysis.importance, base);
  }
  return base;
}

export function aggregateFeedItemsToStories(rawItems: FeedItemWithRelations[]): PublicStory[] {
  const items = rawItems
    .map(toPublicFeedItem)
    .filter(item => !item.hidden && item.analysis?.visibility !== 'hidden' && !isLowValueNotice(item))
    .sort((a, b) => getSortTime(b).getTime() - getSortTime(a).getTime());

  const drafts: StoryDraft[] = [];
  for (const item of items) {
    const signature = buildSignature(item);
    const normalizedTitle = normalizeTitle(item.title);
    const keywords = new Set(signature.keywords);
    const match = drafts.find(draft => canMergeIntoStory(draft, item, normalizedTitle, keywords));

    if (match) {
      match.items.push(item);
      for (const keyword of keywords) match.keywords.add(keyword);
      continue;
    }

    drafts.push({
      signature: signature.key,
      normalizedTitle,
      keywords,
      items: [item]
    });
  }

  return drafts.map(finalizeStory).sort((a, b) => getStorySortTime(b).getTime() - getStorySortTime(a).getTime());
}

export function normalizeImportance(value: string | null | undefined): PublicImportance {
  if (value === 'high' || value === 'urgent') return 'high';
  if (value === 'medium') return 'medium';
  return 'low';
}

export function normalizeVisibility(value: string | null | undefined): PublicVisibility | 'hidden' {
  if (value === 'muted') return 'muted';
  if (value === 'hidden') return 'hidden';
  return 'public';
}

export function isLowValueNotice(item: Pick<PublicFeedItem, 'title' | 'content' | 'analysis'>): boolean {
  const text = `${item.title}\n${item.content}`.toLowerCase();
  if (hasPublicImpactException(text)) return false;
  if (item.analysis?.category === 'enforcement') return true;
  return lowValueNoticePhrases.some(phrase => text.includes(phrase));
}

const lowValueNoticePhrases = [
  '封禁名单',
  '封号名单',
  '处罚名单',
  '处罚公示',
  '违规账号',
  '外挂封禁',
  '作弊处罚',
  '账号处罚',
  '名单公示',
  '举报处理',
  '外挂处理',
  '违规处理'
];

function hasPublicImpactException(text: string): boolean {
  return ['版本更新', '大版本', '维护', '停服', '无法登录', '服务器异常', '反作弊系统', '补偿'].some(keyword => text.includes(keyword));
}

function finalizeStory(draft: StoryDraft): PublicStory {
  const items = [...draft.items].sort(compareStoryItems);
  const primary = items[0];
  const cover = chooseCover(items);
  const publishedAt = newestDate(items.map(item => item.publishedAt));
  const fetchedAt = newestDate(items.map(item => item.fetchedAt)) || primary.fetchedAt;
  const createdAt = newestDate(items.map(item => item.createdAt)) || primary.createdAt;
  const importance = maxImportance(items);
  const visibility = items.some(item => item.analysis?.visibility === 'public') ? 'public' : 'muted';
  const canonicalTitle = chooseCanonicalTitle(items);
  const sources = uniqueStorySources(items);

  return {
    id: `story_${contentHash([primary.game, draft.signature, canonicalTitle]).slice(0, 16)}`,
    canonicalTitle,
    game: primary.game,
    category: chooseCategory(items),
    importance,
    visibility,
    summary: chooseSummary(items),
    reason: primary.analysis?.reason || null,
    coverUrl: cover,
    publishedAt,
    fetchedAt,
    createdAt,
    sourceCount: sources.length,
    itemCount: items.length,
    sources,
    items
  };
}

function compareStoryItems(a: PublicFeedItem, b: PublicFeedItem): number {
  const coverScore = Number(Boolean(b.coverUrl)) - Number(Boolean(a.coverUrl));
  if (coverScore !== 0) return coverScore;

  const sourceScore = sourcePriority(b) - sourcePriority(a);
  if (sourceScore !== 0) return sourceScore;

  const importanceScore = importanceRank[b.analysis?.importance || 'low'] - importanceRank[a.analysis?.importance || 'low'];
  if (importanceScore !== 0) return importanceScore;

  return getSortTime(b).getTime() - getSortTime(a).getTime();
}

function chooseCover(items: PublicFeedItem[]): string | null {
  const sorted = [...items].filter(item => item.coverUrl).sort((a, b) => sourcePriority(b) - sourcePriority(a));
  return sorted[0]?.coverUrl || null;
}

function chooseCanonicalTitle(items: PublicFeedItem[]): string {
  const official = items.find(item => item.source.isOfficial);
  return official?.title || items[0].title;
}

function chooseCategory(items: PublicFeedItem[]): string | null {
  return items.find(item => item.analysis?.category)?.analysis?.category || null;
}

function chooseSummary(items: PublicFeedItem[]): string | null {
  return items.find(item => item.analysis?.summary)?.analysis?.summary || null;
}

function uniqueStorySources(items: PublicFeedItem[]): PublicStory['sources'] {
  const sources = new Map<string, PublicStory['sources'][number]>();
  for (const item of items) {
    const key = `${item.sourceId}:${normalizeSourceUrl(item.url)}`;
    if (sources.has(key)) continue;
    sources.set(key, {
      itemId: item.id,
      sourceId: item.sourceId,
      sourceName: item.source.name,
      sourceType: item.source.type,
      isOfficial: item.source.isOfficial,
      url: item.url,
      title: item.title,
      publishedAt: item.publishedAt
    });
  }
  return [...sources.values()];
}

function maxImportance(items: PublicFeedItem[]): PublicImportance {
  return items.reduce<PublicImportance>((best, item) => {
    const current = item.analysis?.importance || 'low';
    return importanceRank[current] > importanceRank[best] ? current : best;
  }, 'low');
}

const GENERIC_KEYWORDS = new Set([
  '公告', '资讯', '工具', '更新', '推荐', '生日', '角色', '活动',
  '官方', '视频', '直播', '前瞻', '版本', '发布', '上线', '开启',
  '优化', '说明', '修复', '调整', '补偿', '维护', '限时', '新',
  '介绍', '玩法', '内容', '系统', '奖励', '福利', '详情', '预告',
  '演示', '展示', '情报', '速报', '合集', '投稿', '动态',
  '有奖', '有奖活动', '征集', '话题', '问卷', '调查', '投票',
  '抽奖', '兑换', '礼包', '兑换码', '礼包码', '周边', '实物'
]);

function areCategoriesCompatible(a: PublicFeedItem, b: PublicFeedItem): boolean {
  const catA = a.analysis?.category;
  const catB = b.analysis?.category;
  if (!catA || !catB) return true;
  if (catA === catB) return true;
  if (catA === 'enforcement' || catB === 'enforcement') return false;

  const set = new Set([catA, catB]);

  // PV 不与任何其他类别合并
  if (set.has('pv')) return false;

  // 公告、活动、版本更新之间不合并
  if (set.has('announcement') && (set.has('event') || set.has('version'))) return false;
  if (set.has('event') && set.has('version')) return false;

  // 创作者视频不与任何官方内容合并
  if (set.has('creator_video')) return false;

  // 音乐不与公告、活动、版本更新合并
  if ((set.has('music') || set.has('game_music')) && (set.has('announcement') || set.has('event') || set.has('version'))) return false;

  // 预告片不与公告、活动、版本合并
  if ((set.has('trailer') || set.has('movie_trailer')) && (set.has('announcement') || set.has('event') || set.has('version'))) return false;

  return true;
}

function strongKeywordOverlap(draftKeywords: Set<string>, itemKeywords: Set<string>, game?: string): number {
  let count = 0;
  let hasProperNoun = false;
  for (const kw of draftKeywords) {
    if (!kw || GENERIC_KEYWORDS.has(kw)) continue;
    if (game && kw === game.toLowerCase()) continue;
    if (itemKeywords.has(kw)) {
      count++;
      // 检查是否包含专有名词（角色名、版本号、活动名等）
      if (/[《「【]|[一-龥]{2,}|^\d+(\.\d+)?$/u.test(kw)) {
        hasProperNoun = true;
      }
    }
  }
  // 需要 ≥3 个关键词且至少包含一个专有名词
  return hasProperNoun ? count : 0;
}

function shareUrlOrExternalId(draft: StoryDraft, item: PublicFeedItem): boolean {
  const itemUrlNorm = normalizeSourceUrl(item.url);
  for (const existing of draft.items) {
    if (normalizeSourceUrl(existing.url) === itemUrlNorm) return true;
    if (existing.externalId && item.externalId && existing.externalId === item.externalId) return true;
  }
  return false;
}

function canMergeIntoStory(
  draft: StoryDraft,
  item: PublicFeedItem,
  normalizedTitle: string,
  keywords: Set<string>
): boolean {
  const anchor = draft.items[0];
  if (anchor.game !== item.game) return false;
  if (hoursBetween(getSortTime(anchor), getSortTime(item)) > mergeWindowHours(anchor, item)) return false;
  if (!areCategoriesCompatible(anchor, item)) return false;

  // 条件1：标准化标题完全相同（最高置信度）
  if (draft.normalizedTitle && draft.normalizedTitle === normalizedTitle) return true;
  // 条件2：URL 或外部 ID 相同（高置信度）
  if (shareUrlOrExternalId(draft, item)) return true;
  // 条件3：强关键词重叠 >= 3（收紧条件，之前是 2）
  if (strongKeywordOverlap(draft.keywords, keywords, anchor.game) >= 3) return true;

  return false;
}

function buildSignature(item: PublicFeedItem): { key: string; keywords: Set<string> } {
  const normalizedTitle = normalizeTitle(item.title);
  const analysisKeywords = item.analysis?.dedupKeywords || [];
  const keywords = new Set([...analysisKeywords.map(normalizeKeyword), ...inferKeywords(item.title), ...inferKeywords(item.analysis?.summary || '')]);
  const keyParts = [...keywords].filter(Boolean).slice(0, 6);
  return {
    key: keyParts.length > 0 ? `${item.game}:${keyParts.join('|')}` : `${item.game}:${normalizedTitle}`,
    keywords: new Set(keyParts)
  };
}

function normalizeDedupKeywords(value: string | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map(keyword => normalizeKeyword(String(keyword))).filter(Boolean).slice(0, 6);
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  return safeJson<string[]>(value, [])
    .map(keyword => normalizeKeyword(String(keyword)))
    .filter(Boolean)
    .slice(0, 6);
}

function inferKeywords(text: string): string[] {
  const keywords = new Set<string>();
  for (const match of text.matchAll(/[《「【](.{2,24}?)[》」】]/g)) {
    keywords.add(normalizeKeyword(match[1]));
  }
  for (const match of text.matchAll(/\b\d+(?:\.\d+){1,2}\b/g)) {
    keywords.add(match[0]);
  }
  for (const match of text.matchAll(/([\u4e00-\u9fa5A-Za-z0-9]{2,18})(?:版本|活动|前瞻|直播|PV|演示|展示|联动|补偿|维护)/gi)) {
    keywords.add(normalizeKeyword(match[1]));
  }
  return [...keywords].filter(Boolean).slice(0, 8);
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(官方|米游社|bilibili|哔哩哔哩|b站|公告|资讯|投稿|视频|发布|合集)/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function normalizeKeyword(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, '')
    .trim();
}

function normalizeSourceUrl(value: string): string {
  return value
    .trim()
    .replace(/^http:\/\//, 'https://')
    .replace(/^https:\/\/www\./, 'https://')
    .replace(/\/$/, '');
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const value of a) {
    if (b.has(value)) count++;
  }
  return count;
}

function sourcePriority(item: PublicFeedItem): number {
  if (item.source.type === 'bilibili_video') return 40;
  if (item.source.isOfficial) return 30;
  if (item.source.type === 'rsshub') return 20;
  return 10;
}

function mergeWindowHours(a: PublicFeedItem, b: PublicFeedItem): number {
  const categories = new Set([a.analysis?.category, b.analysis?.category, a.itemKind, b.itemKind]);
  if (categories.has('version') || categories.has('character') || categories.has('pv') || categories.has('creator_video')) {
    return 48;
  }
  return 24;
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3_600_000;
}

function getSortTime(item: PublicFeedItem): Date {
  return item.publishedAt || item.createdAt || item.fetchedAt;
}

function getStorySortTime(story: PublicStory): Date {
  return story.publishedAt || story.createdAt || story.fetchedAt;
}

function newestDate(values: Array<Date | null | undefined>): Date | null {
  const timestamps = values.filter(Boolean).map(value => value!.getTime());
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps));
}
