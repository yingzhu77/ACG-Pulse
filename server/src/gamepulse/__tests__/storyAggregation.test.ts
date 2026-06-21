import { describe, expect, test } from 'vitest';
import { aggregateFeedItemsToStories } from '../storyAggregation.js';
import type { FeedItemWithRelations, AnalysisRelation, SourceSelectForPublic } from '../types.js';

function makeSource(overrides: Partial<SourceSelectForPublic> = {}): SourceSelectForPublic {
  return {
    id: 'src1',
    name: 'Test Source',
    type: 'rsshub',
    game: '原神',
    isOfficial: true,
    followed: false,
    healthStatus: 'healthy',
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<AnalysisRelation> = {}): AnalysisRelation {
  return {
    id: 'a1',
    status: 'done',
    category: 'announcement',
    importance: 'medium',
    visibility: 'public',
    confidence: 0.9,
    summary: null,
    reason: null,
    dedupKeywords: '[]',
    provider: 'test',
    model: 'test',
    error: null,
    analyzedAt: new Date(),
    ...overrides,
  };
}

function makeItem(overrides: Partial<FeedItemWithRelations> = {}): FeedItemWithRelations {
  return {
    id: `item_${Math.random().toString(36).slice(2, 8)}`,
    sourceId: 'src1',
    externalId: null,
    itemKind: 'official_post',
    game: '原神',
    title: '测试标题',
    content: '测试内容',
    url: 'https://example.com/test',
    authorName: null,
    authorUrl: null,
    coverUrl: null,
    sourceType: 'rsshub',
    hidden: false,
    publishedAt: new Date('2026-06-01T10:00:00Z'),
    fetchedAt: new Date('2026-06-01T10:05:00Z'),
    createdAt: new Date('2026-06-01T10:05:00Z'),
    updatedAt: new Date('2026-06-01T10:05:00Z'),
    source: makeSource(),
    analysis: makeAnalysis(),
    ...overrides,
  };
}

describe('aggregateFeedItemsToStories', () => {
  test('different birthday/community items should NOT merge', () => {
    const items = [
      makeItem({
        id: 'item_b1',
        title: '【原神】纳西妲生日快乐',
        game: '原神',
        url: 'https://www.miyoushe.com/ys/article/birthday_nahida',
        analysis: makeAnalysis({ category: 'community', dedupKeywords: '["纳西妲","生日"]' }),
        publishedAt: new Date('2026-06-01T10:00:00Z'),
      }),
      makeItem({
        id: 'item_b2',
        title: '【原神】钟离生日贺图',
        game: '原神',
        url: 'https://www.miyoushe.com/ys/article/birthday_zhongli',
        analysis: makeAnalysis({ category: 'community', dedupKeywords: '["钟离","生日"]' }),
        publishedAt: new Date('2026-06-01T11:00:00Z'),
      }),
    ];

    const stories = aggregateFeedItemsToStories(items);
    expect(stories.length).toBe(2);
  });

  test('same character PV from Bilibili and Miyoushe CAN merge via shared dedupKeywords', () => {
    const items = [
      makeItem({
        id: 'item_pv1',
        title: '【原神】玛薇卡角色演示 | 「烈焰的誓言」',
        game: '原神',
        sourceId: 'src_bilibili',
        source: makeSource({ id: 'src_bilibili', name: '原神', type: 'bilibili_video', isOfficial: true }),
        sourceType: 'bilibili_video',
        url: 'https://www.bilibili.com/video/BV1xxx',
        analysis: makeAnalysis({ category: 'pv', dedupKeywords: '["玛薇卡","角色演示","烈焰的誓言"]' }),
        publishedAt: new Date('2026-06-01T10:00:00Z'),
      }),
      makeItem({
        id: 'item_pv2',
        title: '玛薇卡角色演示「烈焰的誓言」',
        game: '原神',
        sourceId: 'src_miyoushe',
        source: makeSource({ id: 'src_miyoushe', name: '米游社', type: 'rsshub', isOfficial: true }),
        sourceType: 'rsshub',
        url: 'https://www.miyoushe.com/ys/article/xxx',
        analysis: makeAnalysis({ category: 'pv', dedupKeywords: '["玛薇卡","角色演示","烈焰的誓言"]' }),
        publishedAt: new Date('2026-06-01T10:30:00Z'),
      }),
    ];

    const stories = aggregateFeedItemsToStories(items);
    expect(stories.length).toBe(1);
    expect(stories[0].sources.length).toBe(2);
    expect(stories[0].itemCount).toBe(2);
  });

  test('same version update from official site and Miyoushe CAN merge via exact title', () => {
    const items = [
      makeItem({
        id: 'item_v1',
        title: '原神5.7版本「灵山遗泽」更新说明',
        game: '原神',
        sourceId: 'src_official',
        source: makeSource({ id: 'src_official', name: '官网', type: 'official_site', isOfficial: true }),
        sourceType: 'official_site',
        url: 'https://ys.mihoyo.com/main/news/xxx',
        analysis: makeAnalysis({ category: 'version', dedupKeywords: '["5.7","灵山遗泽"]' }),
        publishedAt: new Date('2026-06-01T06:00:00Z'),
      }),
      makeItem({
        id: 'item_v2',
        title: '原神5.7版本「灵山遗泽」更新说明',
        game: '原神',
        sourceId: 'src_miyoushe',
        source: makeSource({ id: 'src_miyoushe', name: '米游社', type: 'rsshub', isOfficial: true }),
        sourceType: 'rsshub',
        url: 'https://www.miyoushe.com/ys/article/yyy',
        analysis: makeAnalysis({ category: 'version', dedupKeywords: '["5.7","灵山遗泽"]' }),
        publishedAt: new Date('2026-06-01T06:15:00Z'),
      }),
    ];

    const stories = aggregateFeedItemsToStories(items);
    expect(stories.length).toBe(1);
    expect(stories[0].sources.length).toBe(2);
  });

  test('enforcement notices are filtered out as low-value', () => {
    const enforcement = makeItem({
      id: 'item_enf1',
      title: '违规账号封禁名单公示',
      game: '原神',
      url: 'https://www.miyoushe.com/ys/article/enforcement1',
      analysis: makeAnalysis({ category: 'enforcement' }),
      hidden: false,
    });

    const normal = makeItem({
      id: 'item_norm1',
      title: '原神新角色上线公告',
      game: '原神',
      url: 'https://www.miyoushe.com/ys/article/normal1',
      analysis: makeAnalysis({ category: 'announcement' }),
      publishedAt: new Date('2026-06-01T10:00:00Z'),
    });

    const stories = aggregateFeedItemsToStories([enforcement, normal]);
    expect(stories.length).toBe(1);
    expect(stories[0].canonicalTitle).toBe('原神新角色上线公告');
  });

  test('merged story retains multiple source jump entries', () => {
    const items = [
      makeItem({
        id: 'item_ms1',
        title: '【崩坏：星穹铁道】3.3版本「在黎明升起时坠落」前瞻直播',
        game: '崩坏：星穹铁道',
        sourceId: 'src_bilibili',
        source: makeSource({ id: 'src_bilibili', name: '崩坏：星穹铁道', type: 'bilibili_video', game: '崩坏：星穹铁道' }),
        sourceType: 'bilibili_video',
        url: 'https://www.bilibili.com/video/BV1aaa',
        analysis: makeAnalysis({ category: 'version', importance: 'high', dedupKeywords: '["3.3","黎明升起时坠落","前瞻直播"]' }),
        publishedAt: new Date('2026-06-01T10:00:00Z'),
      }),
      makeItem({
        id: 'item_ms2',
        title: '3.3版本「在黎明升起时坠落」前瞻直播',
        game: '崩坏：星穹铁道',
        sourceId: 'src_miyoushe',
        source: makeSource({ id: 'src_miyoushe', name: '米游社', type: 'rsshub', game: '崩坏：星穹铁道' }),
        sourceType: 'rsshub',
        url: 'https://www.miyoushe.com/sr/article/bbb',
        analysis: makeAnalysis({ category: 'version', importance: 'high', dedupKeywords: '["3.3","黎明升起时坠落","前瞻直播"]' }),
        publishedAt: new Date('2026-06-01T10:10:00Z'),
      }),
      makeItem({
        id: 'item_ms3',
        title: '3.3版本「在黎明升起时坠落」前瞻直播开启',
        game: '崩坏：星穹铁道',
        sourceId: 'src_official',
        source: makeSource({ id: 'src_official', name: '官网', type: 'official_site', isOfficial: true, game: '崩坏：星穹铁道' }),
        sourceType: 'official_site',
        url: 'https://sr.mihoyo.com/news/ccc',
        analysis: makeAnalysis({ category: 'version', importance: 'high', dedupKeywords: '["3.3","黎明升起时坠落","前瞻直播"]' }),
        publishedAt: new Date('2026-06-01T10:20:00Z'),
      }),
    ];

    const stories = aggregateFeedItemsToStories(items);
    expect(stories.length).toBe(1);
    expect(stories[0].sources.length).toBe(3);
    expect(stories[0].itemCount).toBe(3);

    const sourceTypes = stories[0].sources.map(s => s.sourceType).sort();
    expect(sourceTypes).toEqual(['bilibili_video', 'official_site', 'rsshub']);
  });

  test('items from different games never merge', () => {
    const items = [
      makeItem({
        id: 'item_g1',
        title: '版本更新公告',
        game: '原神',
        analysis: makeAnalysis({ category: 'version', dedupKeywords: '["5.7"]' }),
      }),
      makeItem({
        id: 'item_g2',
        title: '版本更新公告',
        game: '崩坏：星穹铁道',
        analysis: makeAnalysis({ category: 'version', dedupKeywords: '["3.3"]' }),
      }),
    ];

    const stories = aggregateFeedItemsToStories(items);
    expect(stories.length).toBe(2);
  });

  test('items sharing only generic keywords do NOT merge', () => {
    const items = [
      makeItem({
        id: 'item_gk1',
        title: '新角色上线公告',
        game: '原神',
        url: 'https://www.miyoushe.com/ys/article/gk1',
        analysis: makeAnalysis({ category: 'announcement', dedupKeywords: '["角色","公告"]' }),
        publishedAt: new Date('2026-06-01T10:00:00Z'),
      }),
      makeItem({
        id: 'item_gk2',
        title: '社区活动公告',
        game: '原神',
        url: 'https://www.miyoushe.com/ys/article/gk2',
        analysis: makeAnalysis({ category: 'community', dedupKeywords: '["活动","公告"]' }),
        publishedAt: new Date('2026-06-01T10:30:00Z'),
      }),
    ];

    const stories = aggregateFeedItemsToStories(items);
    expect(stories.length).toBe(2);
  });

  test('same URL across sources merges via URL match', () => {
    const items = [
      makeItem({
        id: 'item_url1',
        title: '原神官方公告',
        game: '原神',
        url: 'https://www.miyoushe.com/ys/article/123',
        sourceId: 'src1',
        publishedAt: new Date('2026-06-01T10:00:00Z'),
      }),
      makeItem({
        id: 'item_url2',
        title: '原神官方公告（转载）',
        game: '原神',
        url: 'https://www.miyoushe.com/ys/article/123',
        sourceId: 'src2',
        source: makeSource({ id: 'src2', name: '另一源' }),
        publishedAt: new Date('2026-06-01T10:30:00Z'),
      }),
    ];

    const stories = aggregateFeedItemsToStories(items);
    expect(stories.length).toBe(1);
  });

  test('pv and announcement from same game with different keywords do NOT merge', () => {
    const items = [
      makeItem({
        id: 'item_pva1',
        title: '【原神】玛薇卡角色PV「烈焰之心」',
        game: '原神',
        url: 'https://www.bilibili.com/video/BV_pva1',
        analysis: makeAnalysis({ category: 'pv', dedupKeywords: '["玛薇卡","PV","烈焰之心"]' }),
        publishedAt: new Date('2026-06-01T10:00:00Z'),
      }),
      makeItem({
        id: 'item_pva2',
        title: '原神5.7版本更新维护公告',
        game: '原神',
        url: 'https://www.miyoushe.com/ys/article/pva2',
        analysis: makeAnalysis({ category: 'announcement', importance: 'medium', dedupKeywords: '["5.7","维护"]' }),
        publishedAt: new Date('2026-06-01T10:30:00Z'),
      }),
    ];

    const stories = aggregateFeedItemsToStories(items);
    expect(stories.length).toBe(2);
  });

  test('hidden items are excluded', () => {
    const items = [
      makeItem({
        id: 'item_hidden',
        title: '隐藏内容',
        hidden: true,
      }),
      makeItem({
        id: 'item_visible',
        title: '可见内容',
        publishedAt: new Date('2026-06-01T10:00:00Z'),
      }),
    ];

    const stories = aggregateFeedItemsToStories(items);
    expect(stories.length).toBe(1);
    expect(stories[0].canonicalTitle).toBe('可见内容');
  });

  test('items with same externalId merge', () => {
    const items = [
      makeItem({
        id: 'item_eid1',
        externalId: 'ext_12345',
        title: '公告A',
        game: '原神',
        sourceId: 'src1',
        publishedAt: new Date('2026-06-01T10:00:00Z'),
      }),
      makeItem({
        id: 'item_eid2',
        externalId: 'ext_12345',
        title: '公告B（略有不同）',
        game: '原神',
        sourceId: 'src2',
        source: makeSource({ id: 'src2', name: '另一源' }),
        publishedAt: new Date('2026-06-01T10:30:00Z'),
      }),
    ];

    const stories = aggregateFeedItemsToStories(items);
    expect(stories.length).toBe(1);
  });

  test('same URL merges even when AI categories conflict', () => {
    const url = 'https://bilibili.com/video/BV1JEjt6QEuN';
    const items = [
      makeItem({
        id: 'item_trailer',
        externalId: 'BV1JEjt6QEuN',
        title: '魔法少女奈叶 EXCEEDS 正式 PV2',
        url,
        itemKind: 'creator_video',
        analysis: makeAnalysis({ category: 'trailer', importance: 'medium' })
      }),
      makeItem({
        id: 'item_creator',
        externalId: 'https://www.bilibili.com/video/BV1JEjt6QEuN',
        title: '魔法少女奈叶 EXCEEDS 正式 PV2',
        url,
        itemKind: 'creator_video',
        analysis: makeAnalysis({ category: 'creator_video', importance: 'low' })
      })
    ];

    const stories = aggregateFeedItemsToStories(items);

    expect(stories).toHaveLength(1);
    expect(stories[0].itemCount).toBe(2);
  });

  test('same normalized title merges across sources when AI categories conflict', () => {
    const title = '《原神》「月之八」版本活动汇总';
    const items = [
      makeItem({
        id: 'miyoushe_event',
        sourceId: 'miyoushe',
        title,
        game: '原神',
        url: 'https://miyoushe.com/ys/article/76088177',
        publishedAt: new Date('2026-06-18T12:55:11Z'),
        analysis: makeAnalysis({ category: 'event', importance: 'medium' })
      }),
      makeItem({
        id: 'bilibili_version',
        sourceId: 'bilibili',
        source: makeSource({ id: 'bilibili', name: '原神', isOfficial: true }),
        title,
        game: '原神',
        url: 'https://bilibili.com/video/BV1w1jc6JEfL',
        publishedAt: new Date('2026-06-18T12:55:00Z'),
        analysis: makeAnalysis({ category: 'version', importance: 'high' })
      })
    ];

    const stories = aggregateFeedItemsToStories(items);

    expect(stories).toHaveLength(1);
    expect(stories[0].itemCount).toBe(2);
    expect(stories[0].sourceCount).toBe(2);
  });
});
