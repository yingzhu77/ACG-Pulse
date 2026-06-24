import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProviderConfig } from '../ai/providerConfig.js';
import {
  COMMUNITY_SENTIMENT_VERSION,
  analyzeSentimentBatch,
  parseAiSentimentResponse,
  shouldReanalyzeSentiment
} from '../community/sentiment.js';

vi.mock('axios');

const envKeys = [
  'AI_PROVIDER',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_MODEL',
  'OPENROUTER_API_KEY'
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  envKeys.forEach(key => delete process.env[key]);
});

beforeEach(() => {
  envKeys.forEach(key => delete process.env[key]);
});

describe('AI provider defaults', () => {
  it('defaults to DeepSeek and never silently falls back to OpenRouter', () => {
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    process.env.OPENROUTER_API_KEY = 'openrouter-key';

    expect(resolveProviderConfig()).toMatchObject({
      provider: 'deepseek',
      apiKey: 'deepseek-key',
      model: 'deepseek-v4-flash'
    });

    delete process.env.DEEPSEEK_API_KEY;
    expect(resolveProviderConfig()).toBeNull();
  });

  it('rejects an explicitly invalid provider instead of silently using DeepSeek', () => {
    process.env.AI_PROVIDER = 'deepseeek';
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    expect(resolveProviderConfig()).toBeNull();
  });
});

describe('community sentiment parsing and fallback', () => {
  it('parses valid output and clamps score and confidence', () => {
    const [parsed] = parseAiSentimentResponse('0:negative:-2:1.4', 1);
    expect(parsed).toMatchObject({
      label: 'negative',
      score: -1,
      confidence: 1,
      status: 'completed',
      method: 'ai',
      version: COMMUNITY_SENTIMENT_VERSION
    });
  });

  it('marks malformed output as failed instead of neutral', () => {
    const [parsed] = parseAiSentimentResponse('not-a-result', 1);
    expect(parsed).toMatchObject({
      label: 'unknown',
      status: 'failed',
      confidence: 0
    });
  });

  it('marks ambiguous text unavailable when no provider is configured', async () => {
    const [parsed] = await analyzeSentimentBatch(['这次更新看完了']);
    expect(parsed).toMatchObject({
      label: 'unknown',
      status: 'unavailable',
      method: 'none'
    });
  });

  it('keeps clear keyword results without calling the provider', async () => {
    const post = vi.mocked(axios.post);
    const [parsed] = await analyzeSentimentBatch(['这个版本太差了，建议避雷']);
    expect(parsed.label).toBe('negative');
    expect(parsed.method).toBe('keyword');
    expect(post).not.toHaveBeenCalled();
  });

  it('does not treat one weak keyword as a confident rule result', async () => {
    const [parsed] = await analyzeSentimentBatch(['美术讨论']);
    expect(parsed).toMatchObject({
      label: 'unknown',
      status: 'unavailable',
      method: 'none'
    });
  });

  it('marks provider errors as failed', async () => {
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('timeout'));
    const [parsed] = await analyzeSentimentBatch(['普通讨论']);
    expect(parsed).toMatchObject({ label: 'unknown', status: 'failed' });
  });
});

describe('community sentiment reanalysis policy', () => {
  it('reuses current successful results and retries failed or legacy results', () => {
    const recent = new Date().toISOString();
    expect(shouldReanalyzeSentiment({
      sentimentStatus: 'completed',
      sentimentVersion: COMMUNITY_SENTIMENT_VERSION,
      sentimentAnalyzedAt: recent
    })).toBe(false);
    expect(shouldReanalyzeSentiment({
      sentimentStatus: 'failed',
      sentimentVersion: null,
      sentimentAnalyzedAt: recent
    })).toBe(true);
    expect(shouldReanalyzeSentiment({
      sentimentStatus: 'completed',
      sentimentVersion: 'old-version',
      sentimentAnalyzedAt: recent
    })).toBe(true);
    expect(shouldReanalyzeSentiment({
      sentimentStatus: 'completed',
      sentimentVersion: COMMUNITY_SENTIMENT_VERSION,
      sentimentAnalyzedAt: 'invalid-date'
    })).toBe(true);
  });
});
