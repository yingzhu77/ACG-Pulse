import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { canonicalizeIdentityUrl } from '../itemIdentity.js';
import {
  aggregateFeedItemsToStories, isLowValueNotice, legacyComparableTitle, legacyStoryIdForItem,
  pairHasStrongLegacyOverlap, presentEventItems, toPublicFeedItem,
  type PublicFeedItem, type PublicStory
} from '../storyAggregation.js';
import type { FeedItemWithRelations } from '../types.js';

export const eventItemInclude = {
  source: {
    select: { id: true, name: true, type: true, game: true, isOfficial: true, followed: true, healthStatus: true }
  },
  analysis: true
} as const;

export const eventPublicWhere = {
  hidden: false,
  OR: [{ analysis: null }, { analysis: { is: { visibility: 'public' } } }]
} satisfies Prisma.FeedItemWhereInput;

type EventMember = FeedItemWithRelations & { eventId?: string | null; eventProgress?: boolean };
type Candidate = { item: PublicFeedItem; eventId: string; progress: boolean; split: boolean };
const HOUR = 3_600_000;
const MATCH_HORIZON = 14 * 24 * HOUR;
const MAX_EVENT_ARCHIVE_ITEMS = 3;
const LEGACY_BRIDGE_SETTING = 'persistent_event_legacy_bridge_v1';
let synchronization: Promise<void> | null = null;

function itemTime(item: Pick<PublicFeedItem, 'publishedAt' | 'createdAt'>): number {
  return (item.publishedAt || item.createdAt).getTime();
}

function sameArticle(a: PublicFeedItem, b: PublicFeedItem): boolean {
  return Boolean(a.url && b.url && canonicalizeIdentityUrl(a.url) === canonicalizeIdentityUrl(b.url))
    || Boolean(a.sourceId === b.sourceId && a.externalId && a.externalId === b.externalId);
}

const LIFECYCLE_CATEGORY = new Set(['version', 'announcement', 'event', 'other']);
const CAMPAIGN_STAGE = [
  /延期|推迟|取消|顺延|调整.{0,5}时间|更正|勘误/,
  /预下载|预载/,
  /热修|紧急修复|补偿|恢复更新|故障修复/,
  /更新说明|维护公告|正式上线|正式开启|更新公告|更新内容|patch notes|release notes/i,
  /前瞻|预告|预览|先导|直播|preview/i,
  /活动一览|活动说明|活动介绍|活动指南|玩法说明|版本介绍|版本指南|guide/i,
  /结束|结束提醒|关闭/,
  /版本.{0,24}(?:PV|宣传片)|(?:PV|宣传片).{0,24}版本/i
];
const UNRELATED_CAMPAIGN_CUE = /创作者|二创|征集|周边|抽奖|同人|同人创作|投稿激励|生日|角色演示|角色PV|角色宣传片|角色预告|干员PV|角色故事|角色介绍|联动|皮肤|商店/i;
const GENERIC_MARKER = /^(?:版本(?:更新|说明|活动)?|官方(?:公告|消息)?|更新(?:公告|说明)?|全新版本|特别节目|前瞻(?:直播)?|活动(?:指南|预告)?|公告|维护(?:公告)?|更新|详情|新版本)$/;

function explicitMarkers(item: PublicFeedItem): Set<string> {
  // Explicit markers from the headline only; summary/AI keywords are not event identity.
  const title = item.title.normalize('NFKC').toLowerCase();
  const markers = new Set<string>();
  for (const match of title.matchAll(/(?:\bv\s*|版本\s*)?(\d+\.\d+(?:\.\d+)?)(?=\D|$)/gi)) {
    markers.add(`version:${match[1]}`);
  }
  for (const match of title.matchAll(/[《「『【](.{2,24}?)[》」』】]/g)) {
    const key = legacyComparableTitle(match[1]);
    if (key.length >= 2 && !GENERIC_MARKER.test(key) && key !== legacyComparableTitle(item.game)) {
      markers.add(`name:${key}`);
    }
  }
  return markers;
}

const VERSION_PV_TITLE = /版本.{0,24}(?:PV|宣传片)|(?:PV|宣传片).{0,24}版本/i;
const VERSION_PREVIEW_TITLE = /版本.{0,16}(?:前瞻|预览|预告|先导)|(?:前瞻|预览|预告|先导).{0,16}版本/;
const EXCLUDED_PV_CATEGORY = new Set(['creator_video', 'character', 'music', 'game_music', 'movie_trailer']);
const CREATOR_PV_CUE = /解析|解说|混剪|reaction|饭制|粉丝作品|手书|同人|翻拍/i;
const EXPLICIT_VERSION_HEADLINE = /版本[\s：:·-]*(?:正式(?:上线|开启|发布)|上线|前瞻|预告|指南|介绍|活动一览|更新说明|更新公告|维护公告)|(?:前瞻|更新说明|维护公告)\s*[：:]?\s*v?\d+\.\d/i;

export function isOfficialVersionPV(item: PublicFeedItem): boolean {
  if (!item.source.isOfficial || item.itemKind !== 'official_post'
    || EXCLUDED_PV_CATEGORY.has(item.analysis?.category || '')
    || UNRELATED_CAMPAIGN_CUE.test(item.title) || CREATOR_PV_CUE.test(item.title)
    || !(VERSION_PV_TITLE.test(item.title)
      || (item.analysis?.category === 'pv' && VERSION_PREVIEW_TITLE.test(item.title)))) return false;
  return [...explicitMarkers(item)].some(marker => marker.startsWith('version:'));
}

function campaignStage(item: PublicFeedItem): number {
  if (UNRELATED_CAMPAIGN_CUE.test(item.title)) return -1;
  // Official version PV is one distinct stage even if its title says "前瞻 PV".
  if (isOfficialVersionPV(item)) return CAMPAIGN_STAGE.length - 1;
  // Character/fan PV cannot gain a lifecycle stage just by carrying the version number.
  if (VERSION_PV_TITLE.test(item.title) || item.analysis?.category === 'pv') return -1;
  return CAMPAIGN_STAGE.findIndex(pattern => pattern.test(item.title));
}

function isLifecycle(item: PublicFeedItem): boolean {
  return isOfficialVersionPV(item) || (
    item.itemKind !== 'creator_video' && item.itemKind !== 'forum_thread'
    && (!item.analysis?.category || LIFECYCLE_CATEGORY.has(item.analysis.category))
  );
}

export function matchEventCampaign(a: PublicFeedItem, b: PublicFeedItem): boolean {
  if (a.game !== b.game || Math.abs(itemTime(a) - itemTime(b)) > MATCH_HORIZON
    || !isLifecycle(a) || !isLifecycle(b) || campaignStage(a) < 0 || campaignStage(b) < 0) return false;
  const am = explicitMarkers(a);
  const bm = explicitMarkers(b);
  const av = [...am].filter(key => key.startsWith('version:'));
  const bv = [...bm].filter(key => key.startsWith('version:'));
  const an = [...am].filter(key => key.startsWith('name:'));
  const bn = [...bm].filter(key => key.startsWith('name:'));
  // A common version number cannot overrule two explicit, conflicting event names.
  if (av.length && bv.length && !av.some(key => bm.has(key))) return false;
  if (an.length && bn.length && !an.some(key => bm.has(key))) return false;
  const sharedName = an.some(key => bm.has(key));
  const sharedVersion = av.some(key => bm.has(key));
  const aVersionPv = isOfficialVersionPV(a);
  const bVersionPv = isOfficialVersionPV(b);
  if (aVersionPv || bVersionPv) {
    if (!a.source.isOfficial || !b.source.isOfficial || !sharedVersion) return false;
    // Do not pick between two named campaigns merely because the game and version match.
    if (an.length || bn.length) return sharedName;
    return [a, b].every(item => isOfficialVersionPV(item) || EXPLICIT_VERSION_HEADLINE.test(item.title));
  }
  return sharedName || (sharedVersion && !an.length && !bn.length
    && EXPLICIT_VERSION_HEADLINE.test(a.title) && EXPLICIT_VERSION_HEADLINE.test(b.title));
}

function eventMatch(a: PublicFeedItem, b: PublicFeedItem): 0 | 1 | 2 {
  if (a.game !== b.game) return 0;
  const timeGap = Math.abs(itemTime(a) - itemTime(b));
  const aTitle = legacyComparableTitle(a.title);
  const bTitle = legacyComparableTitle(b.title);
  const pvSide = [a, b].some(item => VERSION_PV_TITLE.test(item.title)
    || (item.analysis?.category === 'pv' && VERSION_PREVIEW_TITLE.test(item.title)));
  if (pvSide) return matchEventCampaign(a, b) ? 2 : 0;
  if (timeGap <= 48 * HOUR && aTitle === bTitle && aTitle.length >= 6 && !GENERIC_MARKER.test(aTitle)) return 2;
  if (matchEventCampaign(a, b)) return 2;
  // Require actual headline evidence in addition to the legacy AI-keyword rule.
  // A game name and generic news vocabulary alone have no identity value.
  if (timeGap <= 24 * HOUR && pairHasStrongLegacyOverlap(a, b)) {
    const markers = explicitMarkers(a);
    const otherMarkers = explicitMarkers(b);
    const versions = [...markers].filter(key => key.startsWith('version:'));
    if (versions.length && [...otherMarkers].some(key => key.startsWith('version:'))
      && !versions.some(key => otherMarkers.has(key))) return 0;
    if ([...otherMarkers].some(key => key.startsWith('name:') && markers.has(key))
      && !UNRELATED_CAMPAIGN_CUE.test(a.title) && !UNRELATED_CAMPAIGN_CUE.test(b.title)) return 1;
  }
  return 0;
}

type RepeatableStage = 'repair' | 'compensation' | 'schedule' | 'correction';

function repeatableStage(item: PublicFeedItem): RepeatableStage | null {
  if (/更正|勘误/.test(item.title)) return 'correction';
  if (/延期|推迟|取消|顺延|调整.{0,5}时间/.test(item.title)) return 'schedule';
  if (/补偿/.test(item.title)) return 'compensation';
  if (/热修|紧急修复|恢复更新|故障修复/.test(item.title)) return 'repair';
  return null;
}

const ACTION_FACT: Record<RepeatableStage, RegExp> = {
  repair: /(?:修复|修正|修补|解决|恢复)(?:了|了在|在)?[：: ]*(.+)/,
  compensation: /(?:补偿|补发|发放)(?:内容|奖励|道具|为|了)?[：: ]*(.+)/,
  schedule: /(?:延期|推迟|取消|顺延|调整.{0,5}时间|改期|延长|提前)(?:至|到|为|了)?[：: ]*(.+)/,
  correction: /(?:更正|勘误|校正|修改|改为)(?:为|了|成)?[：: ]*(.+)/
};
const GENERIC_FACT = /^(?:(?:若干|部分|一些|其他|多项|少量|多个)?(?:已知|近期|相关|游戏内|体验|系统|个别|异常|bug|问题|错误|故障|修复|优化|更新|说明|详情|公告|内容|请|为准|见下文|见公告|详见|待定|随后|另行|以官方|会尽快|处理|安排|如下|后续|通知|补偿|热修|敬请留意))+$/i;
const CONCRETE_DEFECT = /无法|不能|未能|丢失|崩溃|闪退|黑屏|卡死|错误显示|错误触发|不生效|失败|不到账|扣除|重复|获取异常|重置|中断|穿模|卡顿|错位|异常|错误|不一致|进不去|收不到|领不到|打不开|进不了|拿不到/;
const GENERIC_REPAIR_CONTEXT = /^(?:部分|一些|若干|用户|玩家|管理员|大家|们|反映的|反馈的|发现的|目前|近期|游戏内|此次|本次)+/;
const REWARD_UNIT = '合成玉|嵌晶玉|石英|原石|星琼|晶石|水晶|体力|代币|补给券|抽卡券|积分';
const AMOUNT = new RegExp(`(\\d+)\\s*(${REWARD_UNIT})|(${REWARD_UNIT})\\s*[×x*:]?\\s*(\\d+)`, 'i');
const CONCRETE_VALUE = /\d+(?:[.:]\d+)?\s*(?:月|日|号|点|时|分|秒|周|天|小时|分钟|元|%|[份个张次枚]|合成玉|嵌晶玉|石英|原石|星琼|晶石|水晶|体力|代币|补给券|抽卡券|积分)|(?:20\d\d[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}:\d{2})/;

function normalizeFact(value: string): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/^(?:了|在|当|玩家|参与者|管理员|旅行者)+/, '')
    .replace(/(?:问题|现象|错误|异常|的情况)+$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .replace(/(?:的)*(?:问题|现象|错误|异常|情况)+$/, '')
    .replace(/不能|未能/g, '无法');
}

function concreteFacts(item: PublicFeedItem, kind: RepeatableStage): Set<string> {
  const facts = new Set<string>();
  // Source text only: a changed headline, model summary, boilerplate or raw
  // URL cannot make a previous fact new. Strip layout before extracting clauses.
  const text = item.content.normalize('NFKC').replace(/<(?:br|\/?p|\/?li)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  if (normalizeFact(text) === normalizeFact(item.title)) return facts;
  for (const clause of text.split(/[\n。！？!?；;，,]+/)) {
    const match = clause.match(ACTION_FACT[kind]);
    if (!match) continue;
    // When the source gives an explicit correction target ("将…更正为"),
    // distinguish the changed fact from another correction with the same value.
    const beforeAction = clause.slice(0, match.index).trim();
    const target = (kind === 'schedule' || kind === 'correction')
      ? normalizeFact(beforeAction.match(/(?:将|把|《|「)([^《》「」：:]{2,30})[》」]?$/)?.[1] || '')
      : '';
    const normalized = normalizeFact(match[1]);
    const fact = kind === 'repair' ? normalized.replace(GENERIC_REPAIR_CONTEXT, '') : normalized;
    if ((target + fact).length < 4 || GENERIC_FACT.test(fact) || !fact) continue;
    if (kind === 'repair' && !CONCRETE_DEFECT.test(match[1])) continue;
    if (kind === 'compensation' && !CONCRETE_VALUE.test(match[1]) && !AMOUNT.test(match[1])) continue;
    if (kind === 'schedule' && !CONCRETE_VALUE.test(match[1]) && !/取消/.test(clause)) continue;
    if (kind === 'correction' && !CONCRETE_VALUE.test(match[1]) && !/改为|应为|正确|实际|更正为/.test(clause)) continue;

    // 300 原石 and 原石 × 300 cite the same award, independent of formatting.
    const amounts = kind === 'compensation'
      ? [...match[1].matchAll(new RegExp(AMOUNT.source, 'gi'))]
      : [];
    if (amounts.length) {
      for (const amount of amounts) facts.add(`${amount[2] || amount[3]}:${amount[1] || amount[4]}`);
    } else {
      facts.add(`${target}:${fact}`);
    }
  }
  return facts;
}

export function toEventEvidenceItem(row: FeedItemWithRelations): PublicFeedItem {
  // The public DTO may excerpt a source to 200 characters; use bounded original
  // material for evaluation, never sending full article bodies to event readers.
  const evidence = toPublicFeedItem(row);
  return { ...evidence, content: row.content.slice(0, 5000) };
}

export function isMaterialEventProgress(
  item: PublicFeedItem, existing: ReadonlyArray<{ item: PublicFeedItem; progress: boolean }>
): boolean {
  if (!existing.length) return true;
  if (existing.some(row => sameArticle(row.item, item))) return false;
  const stage = campaignStage(item);
  const published = item.publishedAt;
  if (!item.source.isOfficial || !published || stage < 0) return false;
  const related = existing.filter(row => matchEventCampaign(row.item, item));
  if (!related.length) return false;
  if (existing.some(row => row.progress && row.item.publishedAt && row.item.publishedAt >= published)) return false;
  const repeat = repeatableStage(item);
  if (repeat) {
    const priorFacts = new Set(related
      .filter(row => row.item.source.isOfficial)
      .flatMap(row => [...concreteFacts(row.item, repeat)]));
    return [...concreteFacts(item, repeat)].some(fact => !priorFacts.has(fact));
  }
  return !existing.some(row => row.progress && campaignStage(row.item) === stage);
}

async function addAliases(
  tx: Prisma.TransactionClient,
  aliases: Array<{ id: string; eventId: string | null }>
): Promise<void> {
  if (!aliases.length) return;
  const previous = await tx.eventAlias.findMany({
    where: { id: { in: [...new Set(aliases.map(alias => alias.id))] } }
  });
  const values = new Map(previous.map(alias => [alias.id, alias.eventId]));
  const original = new Map(values);
  for (const alias of aliases) {
    if (!values.has(alias.id)) values.set(alias.id, alias.eventId);
    else if (values.get(alias.id) !== alias.eventId) values.set(alias.id, null);
  }
  const inserts = [...values].filter(([id]) => !original.has(id)).map(([id, eventId]) => ({ id, eventId }));
  if (inserts.length) await tx.eventAlias.createMany({ data: inserts });
  const conflicts = [...values].filter(([id, value]) => original.get(id) && value === null).map(([id]) => id);
  if (conflicts.length) await tx.eventAlias.updateMany({ where: { id: { in: conflicts } }, data: { eventId: null } });
}

async function synchronize(): Promise<void> {
  const knownEventVisibility = {
    hidden: false,
    OR: [{ analysis: null }, { analysis: { is: { visibility: { in: ['public', 'muted'] } } } }]
  } satisfies Prisma.FeedItemWhereInput;
  const pendingWhere = { ...knownEventVisibility, eventId: null, eventArchived: false } satisfies Prisma.FeedItemWhereInput;
  while (await prisma.feedItem.findFirst({ where: pendingWhere, select: { id: true } })) {
    // Persist against the entire active feed, never for an individual search or filter.
    // Serialize batches, and conditionally attach against NULL so retries cannot churn IDs.
    const processed = await prisma.$transaction(async tx => {
      const incoming = await tx.feedItem.findMany({
        where: pendingWhere,
        include: eventItemInclude,
        take: 120,
        orderBy: [{ createdAt: 'asc' }, { publishedAt: 'asc' }, { id: 'asc' }]
      });
      if (!incoming.length) return 0;
      const times = incoming.map(itemTime);
      const earliest = new Date(Math.min(...times) - MATCH_HORIZON);
      const latest = new Date(Math.max(...times) + MATCH_HORIZON);
      const existing = await tx.feedItem.findMany({
        where: {
          ...knownEventVisibility,
          eventId: { not: null },
          game: { in: [...new Set(incoming.map(item => item.game))] },
          AND: [{ OR: [
            { publishedAt: { gte: earliest, lte: latest } },
            { publishedAt: null, createdAt: { gte: earliest, lte: latest } },
            { url: { in: [...new Set(incoming.map(item => item.url))] } }
          ] }]
        },
        include: eventItemInclude,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      });
      const candidates: Candidate[] = existing.map(row => ({
        item: toEventEvidenceItem(row), eventId: row.eventId!, progress: row.eventProgress, split: row.eventSplit
      }));
      const byId = new Map<string, Candidate[]>();
      for (const candidate of candidates) {
        const event = byId.get(candidate.eventId) || [];
        event.push(candidate);
        byId.set(candidate.eventId, event);
      }
      for (const row of incoming) {
        const item = toEventEvidenceItem(row);
        const matches = new Map<string, number>();
        if (!row.eventSplit) {
          for (const [id, members] of byId) {
            // Exact matches may use any report, but fuzzy links need the original
            // representative; this prevents multi-hop drift across events.
            const anchor = members[0];
            const exact = members.some(member => member.item.game === item.game && sameArticle(member.item, item));
            const rank = exact ? 3 : anchor.split ? 0 : eventMatch(anchor.item, item);
            if (rank > 0) matches.set(id, rank);
          }
        }
        const topRank = Math.max(0, ...matches.values());
        const leaders = [...matches].filter(([, rank]) => rank === topRank);
        const matchedId = leaders.length === 1 ? leaders[0][0] : null;
        const eventId = matchedId || `evt_${randomUUID()}`;
        const group = byId.get(eventId) || [];
        const eventProgress = isMaterialEventProgress(item, group);
        if (!matchedId) await tx.event.create({ data: { id: eventId, game: row.game, createdAt: row.createdAt } });
        const attached = await tx.feedItem.updateMany({
          where: { id: row.id, eventId: null },
          data: { eventId, eventProgress, updatedAt: row.updatedAt }
        });
        if (!attached.count) {
          if (!matchedId) await tx.event.delete({ where: { id: eventId } });
          continue;
        }
        const candidate = { item, eventId, progress: eventProgress, split: row.eventSplit };
        group.push(candidate);
        byId.set(eventId, group);
      }
      return incoming.length;
    }, { timeout: 15_000 });
    if (processed < 120) break;
  }

  // One-time compatibility bridge for old aggregate bookmark IDs, without
  // guessing when the old algorithm combined members now in different events.
  if (await prisma.setting.findUnique({ where: { key: LEGACY_BRIDGE_SETTING }, select: { id: true } })) return;
  await prisma.$transaction(async tx => {
    const rows = await tx.feedItem.findMany({
      where: { hidden: false, eventArchived: false },
      include: eventItemInclude,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
    });
    const eventIds = new Map(rows.map(row => [row.id, row.eventId]));
    const aliases = aggregateFeedItemsToStories(rows).map(story => {
      const candidates = new Set(story.items.map(item => eventIds.get(item.id) || null));
      return { id: story.id, eventId: candidates.size === 1 ? [...candidates][0] : null };
    });
    // Common historical filtered views contained a single member.
    aliases.push(...rows.filter(row => row.eventId).map(row => ({
      id: legacyStoryIdForItem(toPublicFeedItem(row)), eventId: row.eventId
    })));
    for (let i = 0; i < aliases.length; i += 250) await addAliases(tx, aliases.slice(i, i + 250));
    await tx.setting.upsert({ where: { key: LEGACY_BRIDGE_SETTING }, create: { key: LEGACY_BRIDGE_SETTING, value: '1' }, update: {} });
  }, { timeout: 15_000 });
}

export async function syncEvents(): Promise<void> {
  if (!synchronization) synchronization = synchronize().finally(() => { synchronization = null; });
  return synchronization;
}

export interface EventDetail extends PublicStory {
  firstPublishedAt: Date | null;
  firstDiscoveredAt: Date;
  lastProgressAt: Date | null;
  progress: PublicFeedItem[];
}

function projectMembers(
  eventId: string, rawMembers: EventMember[], visibility: 'public' | 'all' = 'public', firstReportId?: string
): EventDetail | null {
  const members = rawMembers
    .filter(row => !row.hidden && row.analysis?.visibility !== 'hidden'
      && (visibility === 'all' || row.analysis?.visibility !== 'muted'))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const dedup = new Map<string, PublicFeedItem>();
  const progression: PublicFeedItem[] = [];
  const visible: PublicFeedItem[] = [];
  for (const row of members) {
    const item = toPublicFeedItem(row);
    if (isLowValueNotice(item)) continue;
    visible.push(item);
    const key = canonicalizeIdentityUrl(item.url) || item.id;
    const previous = dedup.get(key);
    if (!previous || (item.source.isOfficial && !previous.source.isOfficial)) dedup.set(key, item);
    if (row.id !== firstReportId && row.eventProgress && !progression.some(existing => sameArticle(existing, item))) {
      progression.push(item);
    }
  }
  const items = [...dedup.values()];
  if (!items.length) return null;
  const story = presentEventItems(eventId, items);
  const firstPublished = visible.filter(item => item.publishedAt).sort((a, b) => itemTime(a) - itemTime(b))[0];
  const progress = progression.sort((a, b) => itemTime(b) - itemTime(a));
  // Only use analysis already completed against content, never a title-only
  // model completion to invent missing facts. The detail shows the linked source.
  const substantive = new Set(members.filter(item => {
    const content = item.content.trim();
    return content && content !== item.title.trim();
  }).map(item => item.id));
  const summaryItem = [...progress, ...items].find(item =>
    item.analysis?.status === 'completed' && item.analysis.summary && substantive.has(item.id));
  return {
    ...story,
    summary: summaryItem?.analysis?.summary ?? null,
    reason: summaryItem?.analysis?.reason ?? null,
    firstPublishedAt: firstPublished?.publishedAt ?? null,
    firstDiscoveredAt: visible[0].createdAt,
    lastProgressAt: progress[0] ? new Date(itemTime(progress[0])) : null,
    progress
  };
}

export function projectEventMembers(eventId: string, rawMembers: EventMember[]): PublicStory | null {
  return projectMembers(eventId, rawMembers);
}

export function listEventMembers(rawMembers: EventMember[]): PublicStory[] {
  const groups = new Map<string, EventMember[]>();
  for (const row of rawMembers) {
    if (!row.eventId) continue;
    const members = groups.get(row.eventId) || [];
    members.push(row);
    groups.set(row.eventId, members);
  }
  return [...groups].map(([eventId, members]) => projectMembers(eventId, members, 'all'))
    .filter((story): story is EventDetail => story !== null)
    .sort((a, b) => (b.publishedAt || b.createdAt).getTime() - (a.publishedAt || a.createdAt).getTime()
      || a.id.localeCompare(b.id));
}

export async function attachLegacyEventIds(stories: PublicStory[]): Promise<void> {
  if (!stories.length) return;
  const aliases = await prisma.eventAlias.findMany({
    where: { eventId: { in: stories.map(story => story.id) } },
    orderBy: { id: 'asc' }
  });
  const byId = new Map(stories.map(story => [story.id, story]));
  for (const alias of aliases) {
    const story = alias.eventId ? byId.get(alias.eventId) : null;
    if (story) (story.legacyIds ??= []).push(alias.id);
  }
}

export async function publicEventDetails(ids: string[]): Promise<Map<string, EventDetail>> {
  const details = new Map<string, EventDetail>();
  if (!ids.length) return details;
  const rows = await prisma.feedItem.findMany({
    where: { eventId: { in: ids } },
    include: eventItemInclude,
    orderBy: [{ createdAt: 'asc' }, { publishedAt: 'asc' }, { id: 'asc' }]
  });
  const groups = new Map<string, EventMember[]>();
  for (const row of rows) {
    if (!row.eventId) continue;
    const members = groups.get(row.eventId);
    if (members) members.push(row);
    else groups.set(row.eventId, [row]);
  }
  for (const [id, members] of groups) {
    const detail = projectMembers(id, members, 'public', members[0].id);
    if (detail) details.set(id, detail);
  }
  return details;
}

export async function eventProjection(requestedId: string): Promise<EventDetail | null> {
  await syncEvents();
  let id: string | null = requestedId;
  const historical = id.startsWith('story_');
  if (historical || !(await prisma.feedItem.findFirst({ where: { eventId: id }, select: { id: true } }))) {
    id = (await prisma.eventAlias.findUnique({ where: { id } }))?.eventId ?? null;
  }
  if (!id) return null;
  return (await publicEventDetails([id])).get(id) ?? null;
}

/** Move one mistakenly grouped report to a new event without renaming the old event. */
export async function splitEventItem(itemId: string): Promise<string | null> {
  await syncEvents();
  return prisma.$transaction(async tx => {
    const item = await tx.feedItem.findUnique({ where: { id: itemId }, include: eventItemInclude });
    if (!item?.eventId) return null;
    if (item.eventSplit) return item.eventId;
    const memberCount = await tx.feedItem.count({ where: { eventId: item.eventId } });
    if (memberCount === 1) {
      await tx.feedItem.update({ where: { id: item.id }, data: { eventSplit: true, updatedAt: item.updatedAt } });
      return item.eventId;
    }
    const newId = `evt_${randomUUID()}`;
    await tx.event.create({ data: { id: newId, game: item.game, createdAt: item.createdAt } });
    await tx.feedItem.update({
      where: { id: item.id },
      data: { eventId: newId, eventSplit: true, eventProgress: true, updatedAt: item.updatedAt }
    });
    // The old bookmark cannot safely be attributed to either corrected event.
    await tx.eventAlias.updateMany({ where: { eventId: item.eventId }, data: { eventId: null } });
    return newId;
  });
}

/** Keep a small, compact archive per event when the hot feed exceeds its cap. */
export async function archiveFeedOverflow(maxItems: number): Promise<number> {
  await syncEvents();
  let removed = 0;
  for (;;) {
    const processed = await prisma.$transaction(async tx => {
      const activeWhere = { hidden: false, eventArchived: false };
      const count = await tx.feedItem.count({ where: activeWhere });
      if (count <= maxItems) return 0;
      const overflow = await tx.feedItem.findMany({
        where: activeWhere,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: Math.min(count - maxItems, 100),
        select: { id: true, eventId: true }
      });
      const eventIds = [...new Set(overflow.flatMap(row => row.eventId ? [row.eventId] : []))];
      const groups = new Map<string, { id: string; eventProgress: boolean; eventArchived: boolean; content: string; publishedAt: Date | null; updatedAt: Date }[]>();
      if (eventIds.length) {
        const members = await tx.feedItem.findMany({
          where: { ...eventPublicWhere, eventId: { in: eventIds } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, eventId: true, eventProgress: true, eventArchived: true, content: true, publishedAt: true, updatedAt: true }
        });
        for (const member of members) {
          const group = groups.get(member.eventId!) || [];
          group.push(member);
          groups.set(member.eventId!, group);
        }
      }
      const overflowIds = new Set(overflow.map(row => row.id));
      const protect = new Set<string>();
      const obsoleteArchives: string[] = [];
      for (const members of groups.values()) {
        const first = members[0];
        const earliestPublished = [...members].filter(member => member.publishedAt)
          .sort((a, b) => a.publishedAt!.getTime() - b.publishedAt!.getTime())[0];
        const latestProgress = [...members].reverse().find(member => member.eventProgress);
        const retained = [...new Map([first, latestProgress, earliestPublished].filter(member => member !== undefined)
          .map(member => [member.id, member])).values()].slice(0, MAX_EVENT_ARCHIVE_ITEMS);
        const retainedIds = new Set(retained.map(member => member.id));
        for (const row of retained) {
          if (!overflowIds.has(row.id)) continue;
          await tx.feedItem.update({ where: { id: row.id }, data: {
            eventArchived: true, content: row.content.slice(0, 200), updatedAt: row.updatedAt
          } });
          protect.add(row.id);
        }
        obsoleteArchives.push(...members.filter(member => member.eventArchived && !retainedIds.has(member.id)).map(member => member.id));
      }
      const purgedIds = [...overflowIds].filter(id => !protect.has(id)).concat(obsoleteArchives);
      if (purgedIds.length) removed += (await tx.feedItem.deleteMany({ where: { id: { in: purgedIds } } })).count;
      return overflow.length;
    }, { timeout: 15_000 });
    if (processed === 0) break;
  }
  return removed;
}
