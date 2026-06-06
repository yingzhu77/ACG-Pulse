import type { FeedItem, Source } from '@prisma/client';
import { prisma } from '../../db.js';
import { analyzeWithProvider } from './provider.js';

export async function ensureAnalysis(item: FeedItem & { source: Source }, options: { force?: boolean } = {}): Promise<void> {
  const existing = await prisma.analysis.findUnique({
    where: { feedItemId: item.id }
  });

  if (existing?.status === 'completed' && !options.force) return;

  await prisma.analysis.upsert({
    where: { feedItemId: item.id },
    create: {
      feedItemId: item.id,
      status: 'pending'
    },
    update: {
      status: 'pending',
      error: null
    }
  });

  try {
    const result = await analyzeWithProvider({
      title: item.title,
      content: item.content,
      game: item.game,
      sourceName: item.source.name,
      sourceType: item.sourceType,
      sourceIsOfficial: item.source.isOfficial,
      itemKind: item.itemKind,
      publishedAt: item.publishedAt
    });

    // 后处理：强制修正分类边界
    let category = result.analysis.category;

    // 官方源内容只能归入游戏情报分类
    if (item.source.isOfficial) {
      const gameIntelligenceCategories = ['announcement', 'event', 'version', 'character', 'pv', 'game_music', 'community', 'other'];
      if (!gameIntelligenceCategories.includes(category)) {
        // 官方源的音乐内容归为 game_music
        if (category === 'music') {
          category = 'game_music';
        }
        // 官方源的预告/PV内容归为 pv
        else if (category === 'trailer' || category === 'movie_trailer') {
          category = 'pv';
        }
        // 其他情况归为 announcement
        else {
          category = 'announcement';
        }
      }
    }

    // 非官方源内容只能归入关注投稿分类
    if (!item.source.isOfficial) {
      const followCategories = ['music', 'trailer', 'movie_trailer', 'creator_video', 'other'];
      if (!followCategories.includes(category)) {
        // 非官方源的游戏音乐归为 music
        if (category === 'game_music') {
          category = 'music';
        }
        // 非官方源的PV/版本内容归为 trailer
        else if (category === 'pv' || category === 'version' || category === 'character') {
          category = 'trailer';
        }
        // 其他情况归为 other
        else {
          category = 'other';
        }
      }
    }

    await prisma.analysis.update({
      where: { feedItemId: item.id },
      data: {
        status: 'completed',
        category,
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
      }
    });
  } catch (error) {
    await prisma.analysis.update({
      where: { feedItemId: item.id },
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown AI analysis error'
      }
    });
  }
}
