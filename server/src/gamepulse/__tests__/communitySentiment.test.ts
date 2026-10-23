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
  vi.useRealTimers();
  vi.restoreAllMocks();
  envKeys.forEach(key => delete process.env[key]);
});

beforeEach(() => {
  envKeys.forEach(key => delete process.env[key]);
  vi.mocked(axios.post).mockReset();
});

function ambiguousTexts(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `普通话题${index + 1}`);
}

function completion(content: string, finishReason = 'stop') {
  return {
    data: { choices: [{ finish_reason: finishReason, message: { content } }] }
  } as never;
}

function requestTexts(callIndex: number): string[] {
  const body = vi.mocked(axios.post).mock.calls[callIndex][1] as {
    messages: Array<{ content: string }>;
  };
  return body.messages[1].content
    .split('\n')
    .map(line => line.replace(/^\[\d+\]\s?/, ''));
}

function requestMaxTokens(callIndex: number): number {
  const body = vi.mocked(axios.post).mock.calls[callIndex][1] as { max_tokens?: number };
  return body.max_tokens ?? 0;
}

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

  it('marks provider errors as failed without retrying the request', async () => {
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('timeout'));
    const parsed = await analyzeSentimentBatch(ambiguousTexts(3));
    expect(parsed.every(item => item.status === 'failed' && item.label === 'unknown')).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});

describe('community sentiment AI batching resilience', () => {
  it('retries only the missing item after a partial response', async () => {
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    const texts = ambiguousTexts(5);
    vi.mocked(axios.post)
      .mockResolvedValueOnce(completion([
        '0:neutral:0:0.5',
        '1:positive:0.4:0.7',
        '2:negative:-0.4:0.7',
        '3:neutral:0:0.5'
      ].join('\n')))
      .mockResolvedValueOnce(completion('0:positive:0.6:0.8'));

    const results = await analyzeSentimentBatch(texts);

    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(requestTexts(1)).toEqual([texts[4]]);
    expect(results[4]).toMatchObject({ label: 'positive', status: 'completed', method: 'ai' });
    expect(results.slice(0, 4).every(item => item.status === 'completed')).toBe(true);
  });

  it('splits a truncated batch and keeps its completed lines', async () => {
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    const texts = ambiguousTexts(5);
    vi.mocked(axios.post)
      .mockResolvedValueOnce(completion('0:neutral:0:0.5\n2:positive:0.5:0.8', 'length'))
      .mockResolvedValueOnce(completion('0:negative:-0.5:0.8\n1:neutral:0:0.6'))
      .mockResolvedValueOnce(completion('0:neutral:0:0.6'));

    const results = await analyzeSentimentBatch(texts);

    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(requestTexts(0)).toEqual(texts);
    expect(requestTexts(1)).toEqual([texts[1], texts[3]]);
    expect(requestTexts(2)).toEqual([texts[4]]);
    expect(requestMaxTokens(0)).toBe(4096);
    expect(results.map(item => item.label)).toEqual([
      'neutral', 'negative', 'positive', 'neutral', 'neutral'
    ]);
    expect(results.every(item => item.status === 'completed')).toBe(true);
  });

  it('chunks large ambiguous input into bounded batches', async () => {
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    const texts = ambiguousTexts(12);
    vi.mocked(axios.post).mockImplementation(async (_url, body) => {
      const messages = (body as { messages: Array<{ content: string }> }).messages;
      const count = messages[1].content.split('\n').length;
      return completion(
        Array.from({ length: count }, (_, index) => `${index}:neutral:0:0.5`).join('\n')
      );
    });

    const results = await analyzeSentimentBatch(texts);

    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(requestTexts(0)).toEqual(texts.slice(0, 5));
    expect(requestTexts(1)).toEqual(texts.slice(5, 10));
    expect(requestTexts(2)).toEqual(texts.slice(10));
    expect(results.every(item => item.status === 'completed')).toBe(true);
  });

  it('bounds split retries when the provider keeps truncating', async () => {
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    vi.mocked(axios.post).mockResolvedValue(completion('', 'length'));

    const results = await analyzeSentimentBatch(ambiguousTexts(5));

    expect(axios.post).toHaveBeenCalledTimes(7);
    expect(results.every(item => item.status === 'failed' && item.label === 'unknown')).toBe(true);
  });

  it('never retries a single item that truncates', async () => {
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    vi.mocked(axios.post).mockResolvedValue(completion('', 'length'));

    const [parsed] = await analyzeSentimentBatch(ambiguousTexts(1));

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(parsed).toMatchObject({ label: 'unknown', status: 'failed' });
  });
});

describe('community sentiment reanalysis policy', () => {
  it('reuses current successful results and backs off fresh failures', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00.000Z'));
    const recent = new Date(Date.now() - 60_000).toISOString();
    const cooling = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const expired = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();

    expect(shouldReanalyzeSentiment({
      sentimentStatus: 'completed',
      sentimentVersion: COMMUNITY_SENTIMENT_VERSION,
      sentimentAnalyzedAt: recent
    })).toBe(false);
    expect(shouldReanalyzeSentiment({
      sentimentStatus: 'failed',
      sentimentVersion: null,
      sentimentAnalyzedAt: recent
    })).toBe(false);
    expect(shouldReanalyzeSentiment({
      sentimentStatus: 'failed',
      sentimentVersion: null,
      sentimentAnalyzedAt: cooling
    })).toBe(false);
    expect(shouldReanalyzeSentiment({
      sentimentStatus: 'failed',
      sentimentVersion: null,
      sentimentAnalyzedAt: expired
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
    expect(shouldReanalyzeSentiment({
      sentimentStatus: 'unavailable',
      sentimentVersion: null,
      sentimentAnalyzedAt: recent
    })).toBe(true);
  });
});
