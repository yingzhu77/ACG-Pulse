import axios from 'axios';
import { providerHeaders, resolveProviderConfig, type ProviderConfig } from '../ai/providerConfig.js';
import type { SentimentLabel, SentimentMethod, SentimentStatus } from './types.js';

export const COMMUNITY_SENTIMENT_VERSION = '2026-06-24-v1';
const REANALYZE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const FAILED_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const AI_SENTIMENT_BATCH_SIZE = 5;
const AI_SENTIMENT_MAX_TOKENS = 4096;
const AI_SENTIMENT_TIMEOUT_MS = 60_000;
const AI_SENTIMENT_MAX_SPLIT_DEPTH = 2;
const AI_SENTIMENT_SYSTEM_PROMPT = `你是游戏社区情绪分析专家。判断每段文本的整体情感倾向。
需要考虑反讽、阴阳怪气、社区黑话和上下文。无法可靠判断时输出 neutral 且降低 confidence。

每条输出一行：序号:label:score:confidence
label 只能是 positive、negative、neutral。
score 范围 -1 到 1；confidence 范围 0 到 1。
必须为每个序号输出一行，不要省略或合并。只输出结果，不要解释。`;

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
    };
  }>;
}

export interface SentimentResult {
  label: SentimentLabel;
  score: number;
  status: SentimentStatus;
  method: SentimentMethod;
  confidence: number;
  version: string | null;
  analyzedAt: string | null;
}

const POSITIVE_WORDS: Array<[string, number]> = [
  ['yyds', 3], ['永远的神', 3], ['绝绝子', 2], ['太强了', 2], ['封神', 2],
  ['好看', 1], ['牛', 1], ['强', 1], ['神', 1], ['绝了', 1], ['爱了', 1],
  ['太棒', 1], ['期待', 1], ['喜欢', 1], ['推荐', 1], ['必抽', 1], ['必买', 1],
  ['惊艳', 1], ['完美', 1], ['顶级', 1], ['优秀', 1], ['感动', 1], ['泪目', 1],
  ['破防', 1], ['帅', 1], ['美', 1], ['可爱', 1], ['厉害', 1], ['炸裂', 1],
  ['天花板', 1], ['无敌', 1], ['好评', 1], ['值得', 1], ['真香', 1], ['上头', 1],
  ['良心', 1], ['福利', 1], ['白嫖', 1], ['赚了', 1], ['天才', 1], ['杰作', 1]
];

const NEGATIVE_WORDS: Array<[string, number]> = [
  ['太差了', 2], ['不推荐', 2], ['避雷', 2], ['别买', 2], ['别抽', 2],
  ['浪费时间', 2], ['烂', 1], ['差', 1], ['坑', 1], ['失望', 1], ['垃圾', 1],
  ['退', 1], ['恶心', 1], ['抄袭', 1], ['敷衍', 1], ['摆烂', 1], ['崩', 1],
  ['劝退', 1], ['骗', 1], ['亏', 1], ['贵', 1], ['肝', 1], ['氪', 1],
  ['暗改', 1], ['背刺', 1], ['吃相', 1], ['无聊', 1], ['重复', 1], ['换皮', 1],
  ['缝合', 1], ['拉胯', 1], ['离谱', 1], ['过分', 1], ['讨厌', 1], ['无语', 1],
  ['怒', 1], ['喷', 1], ['骂', 1], ['卸载', 1], ['退款', 1], ['后悔', 1],
  ['跑路', 1], ['凉了', 1]
];

function result(
  label: SentimentLabel,
  score: number,
  status: SentimentStatus,
  method: SentimentMethod,
  confidence: number
): SentimentResult {
  return {
    label,
    score,
    status,
    method,
    confidence,
    version: status === 'completed' ? COMMUNITY_SENTIMENT_VERSION : null,
    analyzedAt: new Date().toISOString()
  };
}

export function keywordSentiment(text: string): SentimentResult {
  const lower = text.toLowerCase();
  let positive = 0;
  let negative = 0;
  for (const [word, weight] of POSITIVE_WORDS) {
    if (lower.includes(word)) positive += weight;
  }
  for (const [word, weight] of NEGATIVE_WORDS) {
    if (lower.includes(word)) negative += weight;
  }
  const total = positive + negative;
  if (total === 0) return result('neutral', 0, 'completed', 'keyword', 0.35);

  const score = (positive - negative) / total;
  const evidence = Math.min(total, 3);
  const confidence = Math.min(0.8, 0.5 + evidence * 0.08 + Math.abs(score) * 0.05);
  if (positive > negative) return result('positive', score, 'completed', 'keyword', confidence);
  if (negative > positive) return result('negative', score, 'completed', 'keyword', confidence);
  return result('neutral', 0, 'completed', 'keyword', 0.4);
}

export function shouldReanalyzeSentiment(existing: {
  sentimentStatus: SentimentStatus;
  sentimentVersion: string | null;
  sentimentAnalyzedAt: string | null;
}): boolean {
  if (existing.sentimentStatus === 'completed') {
    if (existing.sentimentVersion !== COMMUNITY_SENTIMENT_VERSION) return true;
    if (!existing.sentimentAnalyzedAt) return true;
    const analyzedAt = Date.parse(existing.sentimentAnalyzedAt);
    if (!Number.isFinite(analyzedAt)) return true;
    return Date.now() - analyzedAt >= REANALYZE_AFTER_MS;
  }

  // A failed AI attempt is retried only after a cooldown, not on every 30-minute refresh.
  if (existing.sentimentStatus === 'failed' && existing.sentimentAnalyzedAt) {
    const analyzedAt = Date.parse(existing.sentimentAnalyzedAt);
    if (Number.isFinite(analyzedAt) && Date.now() - analyzedAt < FAILED_RETRY_COOLDOWN_MS) {
      return false;
    }
  }

  return true;
}

export async function analyzeSentimentBatch(texts: string[]): Promise<SentimentResult[]> {
  const keywordResults = texts.map(keywordSentiment);
  const ambiguousIndices: number[] = [];
  const ambiguousTexts: string[] = [];

  keywordResults.forEach((item, index) => {
    if (Math.abs(item.score) <= 0.3 || item.confidence < 0.65) {
      ambiguousIndices.push(index);
      ambiguousTexts.push(texts[index]);
    }
  });

  if (ambiguousTexts.length === 0) return keywordResults;

  const aiResults = await aiSentimentBatch(ambiguousTexts);
  ambiguousIndices.forEach((originalIndex, aiIndex) => {
    keywordResults[originalIndex] = aiResults[aiIndex];
  });
  return keywordResults;
}

async function aiSentimentBatch(texts: string[]): Promise<SentimentResult[]> {
  const config = resolveProviderConfig();
  if (!config) {
    return texts.map(() => result('unknown', 0, 'unavailable', 'none', 0));
  }

  const results: SentimentResult[] = [];
  for (let start = 0; start < texts.length; start += AI_SENTIMENT_BATCH_SIZE) {
    const chunk = texts.slice(start, start + AI_SENTIMENT_BATCH_SIZE);
    results.push(...await requestSentimentChunk(config, chunk, 0));
  }
  return results;
}

async function requestSentimentChunk(
  config: ProviderConfig,
  texts: string[],
  splitDepth: number
): Promise<SentimentResult[]> {
  const outcome = await requestSentimentOnce(config, texts);
  const failedIndices = outcome.results
    .map((item, index) => (item.status === 'completed' ? -1 : index))
    .filter(index => index >= 0);

  if (!outcome.retryable
    || failedIndices.length === 0
    || texts.length <= 1
    || splitDepth >= AI_SENTIMENT_MAX_SPLIT_DEPTH) {
    return outcome.results;
  }

  const results = [...outcome.results];
  for (const group of splitRetryIndices(failedIndices)) {
    const retried = await requestSentimentChunk(
      config,
      group.map(index => texts[index]),
      splitDepth + 1
    );
    group.forEach((originalIndex, index) => {
      results[originalIndex] = retried[index];
    });
  }
  return results;
}

function splitRetryIndices(indices: number[]): number[][] {
  if (indices.length <= 1) return [indices];
  const midpoint = Math.ceil(indices.length / 2);
  return [indices.slice(0, midpoint), indices.slice(midpoint)];
}

async function requestSentimentOnce(
  config: ProviderConfig,
  texts: string[]
): Promise<{ results: SentimentResult[]; retryable: boolean }> {
  const joined = texts.map((text, index) => `[${index}] ${text.slice(0, 400)}`).join('\n');

  try {
    const response = await axios.post<ChatCompletionResponse>(
      `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        model: config.model,
        messages: [
          { role: 'system', content: AI_SENTIMENT_SYSTEM_PROMPT },
          { role: 'user', content: joined }
        ],
        temperature: 0.1,
        max_tokens: AI_SENTIMENT_MAX_TOKENS
      },
      {
        headers: providerHeaders(config),
        timeout: AI_SENTIMENT_TIMEOUT_MS
      }
    );

    const choice = response.data?.choices?.[0];
    const results = parseAiSentimentResponse(choice?.message?.content || '', texts.length);
    const failed = results.filter(item => item.status !== 'completed').length;
    if (failed > 0) {
      console.warn(
        `[Community] AI sentiment response incomplete: ${failed}/${texts.length}`
        + ` (finish_reason=${choice?.finish_reason || 'unknown'})`
      );
    }
    return { results, retryable: true };
  } catch (error) {
    console.error('[Community] AI sentiment error:', (error as Error).message);
    return {
      results: texts.map(() => result('unknown', 0, 'failed', 'ai', 0)),
      retryable: false
    };
  }
}

export function parseAiSentimentResponse(content: string, expectedCount: number): SentimentResult[] {
  const lines = content.split(/\r?\n/);
  return Array.from({ length: expectedCount }, (_, index) => {
    const line = lines.find(candidate => candidate.trim().startsWith(`${index}:`));
    if (!line) return result('unknown', 0, 'failed', 'ai', 0);

    const [, rawLabel, rawScore, rawConfidence] = line.trim().split(':');
    const label = rawLabel?.trim() as SentimentLabel;
    const score = Number(rawScore);
    const confidence = Number(rawConfidence);
    if (!['positive', 'negative', 'neutral'].includes(label)
      || !Number.isFinite(score)
      || !Number.isFinite(confidence)) {
      return result('unknown', 0, 'failed', 'ai', 0);
    }

    return result(
      label,
      Math.max(-1, Math.min(1, score)),
      'completed',
      'ai',
      Math.max(0, Math.min(1, confidence))
    );
  });
}
