import type { FeedItem, Prisma, Source } from '@prisma/client';
import { prisma } from '../../db.js';
import { analyzeWithProvider, fallbackAnalysis } from './provider.js';

export interface AnalysisExecutionResult {
  status: 'completed' | 'failed' | 'skipped' | 'superseded';
  provider?: string;
  model?: string;
  error?: string;
}

// 内容预筛：太短的内容跳过 AI，直接用规则
function shouldSkipAI(item: FeedItem & { source: Source }): boolean {
  const text = `${item.title} ${item.content}`.trim();
  return text.length < 15;
}

export async function ensureAnalysis(
  item: FeedItem & { source: Source },
  options: { force?: boolean } = {}
): Promise<AnalysisExecutionResult> {
  const preparation = await prisma.$transaction(async tx => {
    const latest = await tx.feedItem.findUnique({ where: { id: item.id }, select: { contentHash: true } });
    if (!latest || latest.contentHash !== item.contentHash) return { status: 'superseded' } as const;

    const existing = await tx.analysis.findUnique({ where: { feedItemId: item.id } });
    if (existing?.status === 'completed' && !options.force) {
      return { status: 'skipped', provider: existing.provider || undefined, model: existing.model || undefined } as const;
    }
    await tx.analysis.upsert({
      where: { feedItemId: item.id },
      create: { feedItemId: item.id, status: 'pending' },
      update: { status: 'pending', error: null }
    });
    return null;
  });
  if (preparation) return preparation;

  // 内容预筛：太短的内容跳过 AI
  if (shouldSkipAI(item)) {
    const fallback = fallbackAnalysis({
      title: item.title,
      content: item.content,
      game: item.game,
      sourceName: item.source.name,
      sourceType: item.sourceType,
      sourceIsOfficial: item.source.isOfficial,
      itemKind: item.itemKind,
      publishedAt: item.publishedAt
    });
    const saved = await writeAnalysisForInput(item, {
      status: 'completed',
      category: fallback.category,
      importance: fallback.importance,
      visibility: fallback.visibility,
      confidence: fallback.confidence,
      summary: fallback.summary,
      reason: '内容过短，规则兜底分析',
      dedupKeywords: '[]',
      provider: 'rules',
      model: 'fallback',
      error: null,
      analyzedAt: new Date()
    });
    return saved ? { status: 'completed', provider: 'rules', model: 'fallback' } : { status: 'superseded' };
  }

  let result: Awaited<ReturnType<typeof analyzeWithProvider>>;
  try {
    result = await analyzeWithProvider({
      title: item.title,
      content: item.content,
      game: item.game,
      sourceName: item.source.name,
      sourceType: item.sourceType,
      sourceIsOfficial: item.source.isOfficial,
      itemKind: item.itemKind,
      publishedAt: item.publishedAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown AI analysis error';
    const saved = await writeAnalysisForInput(item, {
      status: 'failed',
      category: null,
      importance: 'low',
      visibility: 'public',
      confidence: 0,
      summary: null,
      reason: null,
      dedupKeywords: null,
      provider: null,
      model: null,
      analyzedAt: null,
      error: message
    });
    return saved ? { status: 'failed', error: message } : { status: 'superseded' };
  }

  const saved = await writeAnalysisForInput(item, {
    status: 'completed',
    category: result.analysis.category,
    importance: result.analysis.importance,
    visibility: result.analysis.visibility,
    confidence: result.analysis.confidence,
    summary: result.analysis.summary,
    reason: result.analysis.reason,
    dedupKeywords: JSON.stringify(result.analysis.dedupKeywords),
    provider: result.provider,
    model: result.model,
    error: null,
    analyzedAt: new Date()
  });
  return saved
    ? { status: 'completed', provider: result.provider, model: result.model }
    : { status: 'superseded' };
}

async function writeAnalysisForInput(item: FeedItem, data: Prisma.AnalysisUpdateInput): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const latest = await tx.feedItem.findUnique({ where: { id: item.id }, select: { contentHash: true } });
    if (!latest || latest.contentHash !== item.contentHash) return false;
    await tx.analysis.update({ where: { feedItemId: item.id }, data });
    return true;
  });
}
