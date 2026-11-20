import axios from 'axios';
import type { LLMAnalyzeInput, LLMProviderResult, NormalizedAnalysis } from '../types.js';
import { providerHeaders, resolveProviderConfig } from './providerConfig.js';

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
}

export async function analyzeWithProvider(input: LLMAnalyzeInput): Promise<LLMProviderResult> {
  const config = resolveProviderConfig();
  if (!config) {
    return {
      analysis: fallbackAnalysis(input),
      provider: 'fallback',
      model: 'rules'
    };
  }

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post<ChatCompletionResponse>(
        `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          model: config.model,
          messages: [
            {
              role: 'system',
              content: buildSystemPrompt()
            },
            {
              role: 'user',
              content: JSON.stringify({
                title: input.title,
                content: input.content.slice(0, 2500),
                game: input.game,
                sourceName: input.sourceName,
                sourceType: input.sourceType,
                sourceIsOfficial: input.sourceIsOfficial,
                itemKind: input.itemKind,
                publishedAt: input.publishedAt?.toISOString?.() || null,
                lowValueSignals: findLowValueSignals(`${input.title}\n${input.content}`)
              })
            }
          ],
          temperature: 0.2,
          max_tokens: 4000
        },
        {
          timeout: config.provider === 'mimo' ? 90000 : 30000,
          headers: providerHeaders(config)
        }
      );

      const message = response.data.choices?.[0]?.message;
      const content = message?.content || message?.reasoning_content || '';
      const parsed = parseAnalysis(content);
      return {
        analysis: parsed,
        provider: config.provider,
        model: config.model
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

function buildSystemPrompt(): string {
  return `你是游戏/ACG情报编辑。只输出JSON，不要Markdown。

字段：{"category":"announcement|event|version|character|pv|game_music|music|community|enforcement|creator_video|trailer|movie_trailer|other","importance":"low|medium|high","visibility":"public|muted|hidden","confidence":0-100,"summary":"≤40字摘要","reason":"≤60字理由","dedupKeywords":["最多6个"]}

【分类】按内容语义分类，不按 sourceIsOfficial 划组。创作者转载版本更新仍可归 version；只有创作作品本身才归 creator_video、music 等。sourceIsOfficial 只描述原始信源的身份，不证明事实或重要性。

分类速查：
- game_music：作品的官方音乐本身，包括可信转载；music：翻唱/VOCALOID 等作品
- pv：游戏 PV/实机/前瞻本身；trailer：其它预告；movie_trailer：影视预告
- creator_video：创作者杂谈、攻略、实况等独立内容

重要性：high=版本更新/前瞻直播/新角色/大型联动；medium=PV/活动说明/补偿；low=生日贺图/例行提醒/小修复
enforcement=封禁/处罚公示，importance=low，visibility=muted

规则：摘要和理由仅依据给出的标题和正文；缺少依据就明确说无法判断影响，不补写时间、细节或结论。不要因标题含"紧急"或来源是官方就判high；无法判断时category=other,confidence≤60`;
}

function parseAnalysis(content: string): NormalizedAnalysis {
  // 1. Try to extract JSON from markdown code block
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?(\{[\s\S]*?\})\s*\n?```/);
  if (codeBlockMatch) {
    try {
      return normalizeAnalysis(JSON.parse(codeBlockMatch[1]));
    } catch { /* fall through */ }
  }
  // 2. Try to find first complete JSON object (non-greedy)
  const jsonMatch = content.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
  if (jsonMatch) {
    try {
      return normalizeAnalysis(JSON.parse(jsonMatch[0]));
    } catch { /* fall through */ }
  }
  // 3. Brute force: find outermost braces
  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return normalizeAnalysis(JSON.parse(content.slice(firstBrace, lastBrace + 1)));
    } catch { /* fall through */ }
  }
  throw new Error('AI response did not contain JSON');
}

function normalizeAnalysis(value: Partial<NormalizedAnalysis>): NormalizedAnalysis {
  const categories = [
    'announcement',
    'event',
    'version',
    'character',
    'pv',
    'game_music',
    'music',
    'community',
    'enforcement',
    'creator_video',
    'trailer',
    'movie_trailer',
    'other'
  ];
  const importances = ['low', 'medium', 'high'];
  const visibilities = ['public', 'muted', 'hidden'];
  const dedupKeywords = Array.isArray(value.dedupKeywords)
    ? value.dedupKeywords
        .map(keyword => String(keyword || '').trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const importance = String(value.importance) === 'urgent' ? 'high' : String(value.importance);
  return {
    category: categories.includes(String(value.category)) ? value.category! : 'other',
    importance: importances.includes(importance) ? (importance as NormalizedAnalysis['importance']) : 'low',
    visibility: visibilities.includes(String(value.visibility)) ? value.visibility! : 'public',
    confidence: Math.min(100, Math.max(0, Number(value.confidence) || 50)),
    summary: String(value.summary || '').slice(0, 160) || '暂无摘要',
    reason: String(value.reason || '').slice(0, 220) || '规则兜底分析',
    dedupKeywords
  };
}

export function fallbackAnalysis(input: LLMAnalyzeInput): NormalizedAnalysis {
  const text = `${input.title}\n${input.content}`.toLowerCase();
  const signals = findLowValueSignals(text);
  const isLow = signals.length > 0;
  return {
    category: isLow ? 'enforcement' : 'other',
    importance: isLow ? 'low' : 'medium',
    visibility: isLow ? 'muted' : 'public',
    confidence: 35,
    summary: input.title.slice(0, 80) || '暂无摘要',
    reason: '规则兜底分析，未调用 AI',
    dedupKeywords: []
  };
}

function findLowValueSignals(text: string): string[] {
  const signals: string[] = [];
  for (const phrase of lowValuePhrases) {
    if (text.includes(phrase)) signals.push(phrase);
  }
  return signals;
}

const lowValuePhrases = [
  '封禁名单',
  '封号名单',
  '处罚名单',
  '处罚公示',
  '违规账号',
  '外挂封禁',
  '作弊处罚',
  '账号处罚',
  '名单公示',
  '举报处理',
  '外挂处理',
  '违规处理'
];
