import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { eventItemInclude, isMaterialEventProgress, isOfficialVersionPV, matchEventCampaign, toEventEvidenceItem } from './events.js';
import type { PublicFeedItem } from '../storyAggregation.js';

export type RepairCutoff = { since: Date; until: Date; game?: string };
type Merge = { oldId: string; targetId: string; itemIds: string[] };
type Promotion = { id: string; eventId: string };
type Plan = { fingerprint: string; merges: Merge[]; promotions: Promotion[]; skipped: { eventId: string; reason: string }[] };
type Tx = Prisma.TransactionClient;
type Row = Prisma.FeedItemGetPayload<{ include: typeof eventItemInclude }>;
type Member = { row: Row; item: PublicFeedItem };
const DAY = 86_400_000;
const MAX_EVENTS = 400;
const MAX_MEMBERS = 2_000;
const launchTitle = /版本.{0,12}(?:正式上线|正式开启|更新公告|更新说明|更新内容)|(?:patch notes|release notes)/i;
const time = (m: Member) => +(m.row.publishedAt ?? m.row.createdAt);
const chronological = (a: Member, b: Member) => time(a) - time(b) || +a.row.createdAt - +b.row.createdAt || a.row.id.localeCompare(b.row.id);

function validate(scope: RepairCutoff) {
  const span = +scope.until - +scope.since;
  if (!Number.isFinite(span) || span <= 0 || span > 30 * DAY) throw new Error('Use explicit dates spanning at most 30 days');
  if (scope.game !== undefined && !scope.game.trim()) throw new Error('Game cannot be blank');
}

async function compute(tx: Tx, scope: RepairCutoff): Promise<Plan> {
  const window = { gte: scope.since, lt: scope.until };
  const events = await tx.event.findMany({
    where: { ...(scope.game ? { game: scope.game } : {}), items: { some: {
      hidden: false, eventArchived: false, publishedAt: window
    } } },
    select: { id: true },
    take: MAX_EVENTS + 1,
    orderBy: { id: 'asc' }
  });
  if (events.length > MAX_EVENTS) throw new Error('Too many events; narrow the date window or specify one game');
  const ids = events.map(event => event.id);
  const rows = ids.length ? await tx.feedItem.findMany({
    where: { eventId: { in: ids } }, include: eventItemInclude, take: MAX_MEMBERS + 1
  }) : [];
  if (rows.length > MAX_MEMBERS) throw new Error('Too many articles; narrow the date window or specify one game');
  const groups = new Map<string, Member[]>();
  for (const row of rows) {
    const list = groups.get(row.eventId!) ?? [];
    list.push({ row, item: toEventEvidenceItem(row) });
    groups.set(row.eventId!, list);
  }
  for (const group of groups.values()) group.sort(chronological);

  // Protect any publication, including a withdrawn/corrected one and references to pruned originals.
  const alreadyPublished = ids.length ? await tx.dailyEditionEntry.findMany({
    where: { eventId: { in: ids } }, select: { eventId: true }, distinct: ['eventId']
  }) : [];
  const everPublished = new Set(alreadyPublished.map(entry => entry.eventId));
  const byItem = new Map(rows.map(row => [row.id, row.eventId!]));
  for (let offset = 0; offset < rows.length; offset += MAX_EVENTS) {
    const references = await tx.dailyEditionEntry.findMany({
      where: { feedItemId: { in: rows.slice(offset, offset + MAX_EVENTS).map(row => row.id) } },
      select: { feedItemId: true }
    });
    for (const reference of references) everPublished.add(byItem.get(reference.feedItemId)!);
  }
  const usable = (item: Member) => !item.row.hidden && !item.row.eventArchived
    && (!item.row.analysis || item.row.analysis.visibility === 'public');
  const inWindow = (item: Member) => !!item.row.publishedAt && time(item) >= +scope.since && time(item) < +scope.until;
  const compatible = (a: Member, b: Member) => matchEventCampaign(a.item, b.item);
  // A manually split sibling can sit just outside the repair scope while
  // still matching the campaign's 14-day association window.
  const manualRange = { gte: new Date(+scope.since - 14 * DAY), lt: new Date(+scope.until + 14 * DAY) };
  const manualRows = rows.length ? await tx.feedItem.findMany({
    where: { eventSplit: true, game: { in: [...new Set(rows.map(row => row.game))] },
      OR: [{ publishedAt: manualRange }, { publishedAt: null, createdAt: manualRange }] },
    include: eventItemInclude, take: MAX_MEMBERS + 1
  }) : [];
  if (manualRows.length > MAX_MEMBERS) throw new Error('Too many manual decisions; narrow the date window or specify one game');
  const manual = manualRows.map(row => ({ row, item: toEventEvidenceItem(row) }));
  const manuallyProtected = (group: Member[]) => group.some(member => member.row.eventSplit
    || manual.some(split => compatible(member, split)));
  const skipped = new Map<string, string>();
  const candidates = new Map<string, string[]>();
  const possibleDonors = new Map<string, string[]>();
  for (const [targetId, group] of groups) {
    const preview = group.find(member => usable(member) && inWindow(member) && isOfficialVersionPV(member.item));
    if (!preview) continue;
    for (const [oldId, oldGroup] of groups) {
      if (targetId === oldId || oldGroup.length === 0) continue;
      const launch = oldGroup[0];
      if (!usable(launch) || !inWindow(launch) || !launch.row.source.isOfficial
        || launch.row.analysis?.category !== 'version' || !launchTitle.test(launch.row.title)
        || time(launch) <= time(preview) || !compatible(preview, launch)
        || !oldGroup.every(member => inWindow(member) && usable(member) && compatible(preview, member))) continue;
      candidates.set(oldId, [...(candidates.get(oldId) ?? []), targetId]);
      possibleDonors.set(targetId, [...(possibleDonors.get(targetId) ?? []), oldId]);
    }
  }

  const merges: Merge[] = [];
  const promotions: Promotion[] = [];
  for (const [oldId, targets] of candidates) {
    const targetId = targets[0];
    const oldGroup = groups.get(oldId)!;
    const targetGroup = groups.get(targetId)!;
    if (targets.length !== 1 || possibleDonors.get(targetId)?.length !== 1 || candidates.has(targetId)
      || possibleDonors.has(oldId) || targetGroup.some(member =>
        usable(member) && member.row.id !== oldGroup[0].row.id
        && member.row.analysis?.category === 'version' && launchTitle.test(member.row.title)
        && compatible(member, oldGroup[0])
      )) {
      skipped.set(oldId, 'ambiguous edition association');
    } else if (everPublished.has(oldId)) {
      skipped.set(oldId, 'published edition references the old event; use editorial correction');
    } else if (manuallyProtected(oldGroup) || manuallyProtected(targetGroup)) {
      skipped.set(oldId, 'manual event separation');
    } else {
      merges.push({ oldId, targetId, itemIds: oldGroup.map(member => member.row.id) });
      groups.set(targetId, [...targetGroup, ...oldGroup].sort(chronological));
    }
  }

  const moving = new Set(merges.map(merge => merge.oldId));
  for (const [eventId, group] of groups) {
    if (moving.has(eventId) || manuallyProtected(group) || group.some(member => member.row.eventArchived)) continue;
    const prior: { item: PublicFeedItem; progress: boolean }[] = [];
    for (const member of group) {
      if (!usable(member)) continue;
      let progress = member.row.eventProgress;
      if (!progress && prior.length && inWindow(member) && isMaterialEventProgress(member.item, prior)) {
        promotions.push({ id: member.row.id, eventId });
        progress = true;
      }
      prior.push({ item: member.item, progress });
    }
  }
  const changes = { merges, promotions, skipped: [...skipped].map(([eventId, reason]) => ({ eventId, reason })) };
  const fingerprint = createHash('sha256').update(JSON.stringify({ scope, ...changes })).digest('hex');
  return { fingerprint, ...changes };
}

export async function previewEventRepair(db: PrismaClient, scope: RepairCutoff): Promise<Plan> {
  validate(scope);
  return db.$transaction(tx => compute(tx, scope), { timeout: 15_000 });
}

export async function applyEventRepair(db: PrismaClient, scope: RepairCutoff, fingerprint: string): Promise<Plan> {
  validate(scope);
  return db.$transaction(async tx => {
    const plan = await compute(tx, scope);
    if (fingerprint !== plan.fingerprint) throw new Error('Repair fingerprint changed; run the preview again');
    for (const { oldId, targetId, itemIds } of plan.merges) {
      const rows = await tx.feedItem.findMany({
        where: { id: { in: itemIds }, eventId: oldId }, select: { id: true, updatedAt: true }
      });
      for (const item of rows) await tx.feedItem.update({
        where: { id: item.id }, data: { eventId: targetId, updatedAt: item.updatedAt }
      });
      await tx.eventAlias.updateMany({ where: { eventId: oldId }, data: { eventId: targetId } });
      await tx.eventAlias.upsert({ where: { id: oldId }, create: { id: oldId, eventId: targetId }, update: { eventId: targetId } });
    }
    for (const { id, eventId } of plan.promotions) {
      const article = await tx.feedItem.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } });
      await tx.feedItem.update({ where: { id, eventId }, data: { eventProgress: true, updatedAt: article.updatedAt } });
    }
    return plan;
  }, { timeout: 20_000 });
}
