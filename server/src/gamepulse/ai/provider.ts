import axios from 'axios';
import type { LLMAnalyzeInput, LLMProviderResult, NormalizedAnalysis } from '../types.js';

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface ProviderConfig {
  provider: 'openrouter' | 'deepseek';
  apiKey: string;
  baseUrl: string;
  model: string;
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
      max_tokens: 500
    },
    {
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...(config.provider === 'openrouter'
          ? {
              'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
              'X-Title': 'Game Pulse'
            }
          : {})
      }
    }
  );

  const content = response.data.choices?.[0]?.message?.content || '';
  const parsed = parseAnalysis(content);
  return {
    analysis: parsed,
    provider: config.provider,
    model: config.model
  };
}

function resolveProviderConfig(): ProviderConfig | null {
  const preferred = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();
  if (preferred === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return null;
    return {
      provider: 'deepseek',
      apiKey,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
    };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return {
    provider: 'openrouter',
    apiKey,
    baseUrl: 'https://openrouter.ai/api/v1',
    model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v3.2'
  };
}

function buildSystemPrompt(): string {
  return `你是一个游戏/ACG 情报编辑，负责把官方公告、PV、创作者视频整理成稳定的情报卡片。

用户主要关注二游/ACG 资讯。判断标准不是官方语气是否严肃，而是普通玩家是否值得立刻知道。

请只输出 JSON，不要输出 Markdown。字段如下：
{
  "category": "announcement|event|version|character|pv|game_music|music|community|enforcement|creator_video|trailer|movie_trailer|other",
  "importance": "low|medium|high",
  "visibility": "public|muted|hidden",
  "confidence": 0-100,
  "summary": "不超过 80 个中文字，说明这条内容对玩家有什么用",
  "reason": "不超过 100 个中文字，说明分类、重要性、展示状态和可信度依据",
  "dedupKeywords": ["用于跨源合并的角色名、版本号、活动名、PV名，最多 6 个"]
}

【重要】分类边界规则（必须严格遵守）：

【核心规则】sourceIsOfficial 字段决定分类归属：
- sourceIsOfficial=true → 游戏官方源，内容归入游戏情报分类（announcement/event/version/character/pv/game_music/community/other）
- sourceIsOfficial=false → 非官方源，内容归入关注投稿分类（music/trailer/movie_trailer/creator_video/other）
- 【禁止】官方源内容出现在关注投稿分类中
- 【禁止】非官方源内容出现在游戏情报分类中

1. game_music 分类边界（游戏EP）：
   - 【必须】sourceIsOfficial=true 才能使用此分类
   - 用于游戏官方发布的音乐内容：角色 EP、原声带、主题曲、角色歌、OST、游戏音乐联动
   - 关键判断：如果标题包含"EP""主题曲""角色歌""OST""音乐"且来源是游戏官方，必须归为 game_music
   - 【禁止】非官方源的音乐内容归入 game_music

2. music 分类边界（最新音乐）：
   - 【必须】sourceIsOfficial=false 才能使用此分类
   - 用于创作者发布的非游戏官方音乐内容：翻唱、VOCALOID、原创音乐、动漫 OP/ED 翻译、日语歌翻译、音乐杂谈
   - 关键判断：如果标题包含"翻唱""翻奏""cover""VOCALOID""原创"且来源是非官方UP主，必须归为 music
   - 【禁止】官方源的音乐内容归入 music

3. pv 分类边界（PV影像）：
   - 【必须】sourceIsOfficial=true 才能使用此分类
   - 用于游戏官方发布的视频内容：版本 PV、角色 PV、过场动画、实机演示、前瞻直播回放
   - 关键判断：如果内容是视频且来源是游戏官方，优先归为 pv
   - 【禁止】非官方源的视频内容归入 pv

4. trailer 分类边界（ACG内容）：
   - 【必须】sourceIsOfficial=false 才能使用此分类
   - 用于非官方源发布的游戏预告、动漫先行版、简中字幕版、动画 PV、番剧相关内容
   - 包括：IGN等媒体发布的游戏预告、番剧先行版、简中字幕版本、动画 PV、动漫杂谈
   - 关键判断：如果 sourceIsOfficial=false 且内容是预告/视频，必须归为 trailer

5. movie_trailer 分类边界（电影预告）：
   - 【必须】sourceIsOfficial=false 才能使用此分类
   - 用于非官方源发布的电影、剧集、动画电影预告片
   - 关键判断：如果内容是电影/剧集预告且来源是非官方，必须归为 movie_trailer

6. creator_video 分类边界（创作者视频）：
   - 【必须】sourceIsOfficial=false 才能使用此分类
   - 用于创作者发布的非音乐、非预告类视频：攻略、杂谈、实况、解说、评测、Vlog

7. other 分类边界：
   - 只用于无法归入任何其他分类的内容
   - 尽量避免使用此分类

判断规则：
- high：版本更新、前瞻直播、新角色/新卡池、限时活动开启、大型联动、长时间服务器异常且影响游玩。
- medium：角色 PV/技能演示、活动说明、优化说明、补偿公告、官方幕后视频、实用工具更新。
- low：生日贺图、社区活动、例行提醒、小修复、不影响多数玩家的已知问题。
- 封禁名单、违规处罚公示、例行安全公告、社区治理通知通常 category=enforcement，importance=low，visibility=muted 或 hidden。
- 不要因为标题包含"紧急""重要"就自动判 high。
- 真正影响游玩的大规模异常、停服维护、版本更新可 visibility=public。
- visibility=hidden 只用于纯名单、公示、重复治理通知等普通玩家几乎不需要看的内容；不确定时用 muted。
- 官方源可信度高；创作者源需要按标题和内容保守判断。
- 不要虚构内容，无法判断时 category=other、importance=low、confidence 不超过 60。`;
}

function parseAnalysis(content: string): NormalizedAnalysis {
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) {
    throw new Error('AI response did not contain JSON');
  }
  const parsed = JSON.parse(json) as Partial<NormalizedAnalysis>;
  return normalizeAnalysis(parsed);
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

function fallbackAnalysis(input: LLMAnalyzeInput): NormalizedAnalysis {
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
