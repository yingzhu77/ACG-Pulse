import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios');
import axios from 'axios';
import { analyzeWithProvider, fallbackAnalysis } from '../ai/provider.js';
import type { LLMAnalyzeInput } from '../types.js';

const baseInput: LLMAnalyzeInput = {
  title: '原神4.5版本前瞻直播',
  content: '新版本即将上线，包含新角色和新地图',
  game: '原神',
  sourceName: '原神官方微博',
  sourceType: 'weibo',
  sourceIsOfficial: true,
  itemKind: 'post',
  publishedAt: new Date('2026-06-15T10:00:00Z')
};

const mockPost = vi.mocked(axios.post);

function mockProviderResponse(content: string) {
  mockPost.mockResolvedValueOnce({
    data: {
      choices: [{ message: { content } }]
    }
  });
}

describe('AI JSON parsing', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_PROVIDER = 'mimo';
    process.env.MIMO_API_KEY = 'test-key';
    delete process.env.MIMO_BASE_URL;
    delete process.env.MIMO_MODEL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  test('parses plain JSON response', async () => {
    mockProviderResponse(JSON.stringify({
      category: 'announcement',
      importance: 'high',
      visibility: 'public',
      confidence: 90,
      summary: '4.5版本前瞻直播',
      reason: '官方版本更新',
      dedupKeywords: ['原神', '4.5']
    }));

    const result = await analyzeWithProvider(baseInput);

    expect(result.analysis.category).toBe('announcement');
    expect(result.analysis.importance).toBe('high');
    expect(result.analysis.confidence).toBe(90);
    expect(result.provider).toBe('mimo');
  });

  test('uses the current DeepSeek Flash model by default', async () => {
    process.env.AI_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
    delete process.env.DEEPSEEK_BASE_URL;
    delete process.env.DEEPSEEK_MODEL;
    mockProviderResponse(JSON.stringify({
      category: 'announcement',
      importance: 'high',
      visibility: 'public',
      confidence: 90,
      summary: '测试摘要',
      reason: '测试原因',
      dedupKeywords: []
    }));

    const result = await analyzeWithProvider(baseInput);

    expect(result.provider).toBe('deepseek');
    expect(result.model).toBe('deepseek-v4-flash');
    expect(mockPost).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({ model: 'deepseek-v4-flash' }),
      expect.any(Object)
    );
  });

  test('parses JSON wrapped in markdown code block', async () => {
    mockProviderResponse('```json\n{"category":"event","importance":"medium","visibility":"public","confidence":80,"summary":"测试摘要","reason":"测试原因","dedupKeywords":[]}\n```');

    const result = await analyzeWithProvider(baseInput);

    expect(result.analysis.category).toBe('event');
    expect(result.analysis.importance).toBe('medium');
  });

  test('parses JSON with surrounding text', async () => {
    mockProviderResponse('根据分析，结果如下：\n{"category":"character","importance":"high","visibility":"public","confidence":85,"summary":"新角色公布","reason":"官方角色发布","dedupKeywords":["角色"]}\n以上是分析结果。');

    const result = await analyzeWithProvider(baseInput);

    expect(result.analysis.category).toBe('character');
    expect(result.analysis.confidence).toBe(85);
  });

  test('normalizes urgent importance to high', async () => {
    mockProviderResponse(JSON.stringify({
      category: 'announcement',
      importance: 'urgent',
      visibility: 'public',
      confidence: 95,
      summary: '紧急公告',
      reason: '测试',
      dedupKeywords: []
    }));

    const result = await analyzeWithProvider(baseInput);

    expect(result.analysis.importance).toBe('high');
  });

  test('normalizes invalid category to other', async () => {
    mockProviderResponse(JSON.stringify({
      category: 'invalid_category',
      importance: 'medium',
      visibility: 'public',
      confidence: 50,
      summary: '测试',
      reason: '测试',
      dedupKeywords: []
    }));

    const result = await analyzeWithProvider(baseInput);

    expect(result.analysis.category).toBe('other');
  });

  test('normalizes invalid importance to low', async () => {
    mockProviderResponse(JSON.stringify({
      category: 'other',
      importance: 'super_high',
      visibility: 'public',
      confidence: 50,
      summary: '测试',
      reason: '测试',
      dedupKeywords: []
    }));

    const result = await analyzeWithProvider(baseInput);

    expect(result.analysis.importance).toBe('low');
  });

  test('clamps confidence to 0-100 range', async () => {
    mockProviderResponse(JSON.stringify({
      category: 'other',
      importance: 'low',
      visibility: 'public',
      confidence: 150,
      summary: '测试',
      reason: '测试',
      dedupKeywords: []
    }));

    const result = await analyzeWithProvider(baseInput);

    expect(result.analysis.confidence).toBe(100);
  });

  test('truncates summary to 160 chars', async () => {
    const longSummary = 'A'.repeat(200);
    mockProviderResponse(JSON.stringify({
      category: 'other',
      importance: 'low',
      visibility: 'public',
      confidence: 50,
      summary: longSummary,
      reason: '测试',
      dedupKeywords: []
    }));

    const result = await analyzeWithProvider(baseInput);

    expect(result.analysis.summary.length).toBeLessThanOrEqual(160);
  });

  test('limits dedupKeywords to 6 items', async () => {
    mockProviderResponse(JSON.stringify({
      category: 'other',
      importance: 'low',
      visibility: 'public',
      confidence: 50,
      summary: '测试',
      reason: '测试',
      dedupKeywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    }));

    const result = await analyzeWithProvider(baseInput);

    expect(result.analysis.dedupKeywords.length).toBeLessThanOrEqual(6);
  });

  test('falls back to defaults on missing fields', async () => {
    mockProviderResponse(JSON.stringify({
      category: 'other'
    }));

    const result = await analyzeWithProvider(baseInput);

    expect(result.analysis.importance).toBe('low');
    expect(result.analysis.visibility).toBe('public');
    expect(result.analysis.confidence).toBe(50);
    expect(result.analysis.summary).toBe('暂无摘要');
  });

  test('retries on API error and throws after max retries', async () => {
    mockPost.mockRejectedValue(new Error('network error'));

    await expect(analyzeWithProvider(baseInput)).rejects.toThrow('network error');
    // 1 initial + 2 retries = 3 calls
    expect(mockPost).toHaveBeenCalledTimes(3);
  });

  test('returns result on successful retry', async () => {
    mockPost.mockRejectedValueOnce(new Error('timeout'));
    mockProviderResponse(JSON.stringify({
      category: 'other',
      importance: 'low',
      visibility: 'public',
      confidence: 50,
      summary: '重试成功',
      reason: '测试',
      dedupKeywords: []
    }));

    const result = await analyzeWithProvider(baseInput);

    expect(result.analysis.summary).toBe('重试成功');
    expect(mockPost).toHaveBeenCalledTimes(2);
  });
});

describe('fallbackAnalysis', () => {
  test('returns medium importance for normal content', () => {
    const result = fallbackAnalysis({
      title: '新版本更新说明',
      content: '本次更新包含多项优化',
      game: '原神',
      sourceName: '测试源',
      sourceType: 'rss',
      sourceIsOfficial: true,
      itemKind: 'post',
      publishedAt: new Date()
    });

    expect(result.category).toBe('other');
    expect(result.importance).toBe('medium');
    expect(result.visibility).toBe('public');
    expect(result.confidence).toBe(35);
    expect(result.reason).toBe('规则兜底分析，未调用 AI');
  });

  test('detects low-value enforcement content', () => {
    const result = fallbackAnalysis({
      title: '外挂封禁名单公示',
      content: '以下账号因使用外挂被封禁',
      game: '原神',
      sourceName: '测试源',
      sourceType: 'rss',
      sourceIsOfficial: true,
      itemKind: 'post',
      publishedAt: new Date()
    });

    expect(result.category).toBe('enforcement');
    expect(result.importance).toBe('low');
    expect(result.visibility).toBe('muted');
  });

  test('detects multiple low-value signals', () => {
    const result = fallbackAnalysis({
      title: '处罚名单',
      content: '违规账号处理公示',
      game: '原神',
      sourceName: '测试源',
      sourceType: 'rss',
      sourceIsOfficial: true,
      itemKind: 'post',
      publishedAt: new Date()
    });

    expect(result.category).toBe('enforcement');
    expect(result.importance).toBe('low');
  });
});
