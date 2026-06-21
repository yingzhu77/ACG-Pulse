import { prisma } from '../../db.js';
import { buildFeedItemIdentityKey } from '../itemIdentity.js';
import { invalidatePublicStatsCache } from './statsService.js';

export interface FeedItemIdentityCandidate {
  id: string;
  sourceId: string;
  externalId: string | null;
  url: string;
  identityKey: string | null;
  hidden: boolean;
  coverUrl: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  analysis: {
    status: string;
    importance: string;
    confidence: number;
  } | null;
}

export interface FeedItemIdentityPlan {
  duplicateIds: string[];
  assignments: Array<{ id: string; identityKey: string }>;
}

const importanceScore: Record<string, number> = { high: 300, medium: 200, low: 100 };

function candidateScore(item: FeedItemIdentityCandidate): number {
  return (item.identityKey ? 100_000 : 0)
    + (item.hidden ? 0 : 10_000)
    + (item.analysis?.status === 'completed' ? 1_000 : 0)
    + (importanceScore[item.analysis?.importance || ''] || 0)
    + (item.analysis?.confidence || 0)
    + (item.coverUrl ? 20 : 0);
}

export function planFeedItemIdentityBackfill(items: FeedItemIdentityCandidate[]): FeedItemIdentityPlan {
  const groups = new Map<string, FeedItemIdentityCandidate[]>();

  for (const item of items) {
    const identityKey = buildFeedItemIdentityKey(item);
    const groupKey = `${item.sourceId}:${identityKey}`;
    const group = groups.get(groupKey) || [];
    group.push(item);
    groups.set(groupKey, group);
  }

  const duplicateIds: string[] = [];
  const assignments: Array<{ id: string; identityKey: string }> = [];

  for (const group of groups.values()) {
    group.sort((a, b) => {
      const scoreDiff = candidateScore(b) - candidateScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      const timeA = (a.publishedAt || a.createdAt).getTime();
      const timeB = (b.publishedAt || b.createdAt).getTime();
      return timeB - timeA;
    });

    const keeper = group[0];
    const identityKey = buildFeedItemIdentityKey(keeper);
    if (keeper.identityKey !== identityKey) assignments.push({ id: keeper.id, identityKey });
    duplicateIds.push(...group.slice(1).map(item => item.id));
  }

  return { duplicateIds, assignments };
}

export async function backfillFeedItemIdentities(): Promise<{ deleted: number; backfilled: number }> {
  const pendingCount = await prisma.feedItem.count({ where: { identityKey: null } });
  if (pendingCount === 0) return { deleted: 0, backfilled: 0 };

  const items = await prisma.feedItem.findMany({
    select: {
      id: true,
      sourceId: true,
      externalId: true,
      url: true,
      identityKey: true,
      hidden: true,
      coverUrl: true,
      publishedAt: true,
      createdAt: true,
      analysis: { select: { status: true, importance: true, confidence: true } }
    }
  });
  const plan = planFeedItemIdentityBackfill(items);

  let deletedCount = 0;
  if (plan.duplicateIds.length > 0) {
    const [, deleted] = await prisma.$transaction([
      prisma.notification.deleteMany({ where: { feedItemId: { in: plan.duplicateIds } } }),
      prisma.feedItem.deleteMany({ where: { id: { in: plan.duplicateIds } } })
    ]);
    deletedCount = deleted.count;
  }

  const survivingAssignments = plan.assignments.filter(item => !plan.duplicateIds.includes(item.id));
  for (let offset = 0; offset < survivingAssignments.length; offset += 100) {
    const batch = survivingAssignments.slice(offset, offset + 100);
    await prisma.$transaction(batch.map(item => prisma.feedItem.update({
      where: { id: item.id },
      data: { identityKey: item.identityKey }
    })));
  }

  if (deletedCount > 0 || survivingAssignments.length > 0) {
    console.log(`[GamePulse] Identity backfill completed: ${survivingAssignments.length} assigned, ${deletedCount} duplicates removed`);
    invalidatePublicStatsCache();
  }

  return { deleted: deletedCount, backfilled: survivingAssignments.length };
}
