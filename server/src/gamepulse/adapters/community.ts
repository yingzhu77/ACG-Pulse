/**
 * Community hot topics adapter.
 * Multi-source: Bilibili ranking + NGA forum + Xiaoheihe.
 * Features: sentiment analysis, time-decay heat scoring, trend tracking, dedup.
 */

import axios from 'axios';
import crypto from 'crypto';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ===== Types =====

export interface CommunityTopic {
  id: string;
  title: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentimentScore: number; // -1 to 1
  heatScore: number;
  category: string;
  source: string;
  trend: number[];
  summary: string;
  url: string;
  publishedAt: string;
}

// ===== B站 API =====

interface BilibiliVideo {
  aid: number;
  bvid: string;
  title: string;
  desc?: string;
  owner?: { name: string; mid: number };
  stat?: { view: number; like: number; reply: number; danmaku: number };
  pubdate?: number;
  tag?: string[];
  tname?: string;
}

interface BilibiliComment {
  rpid: number;
  content?: { message: string };
  member?: { uname: string };
  like?: number;
}

async function fetchBilibiliGameRanking(): Promise<BilibiliVideo[]> {
  try {
    const resp = await axios.get('https://api.bilibili.com/x/web-interface/ranking/v2', {
      params: { rid: 17, type: 'all' },
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10000
    });
    return resp.data.code === 0 ? (resp.data.data?.list || []).slice(0, 20) : [];
  } catch { return []; }
}

async function fetchBilibiliAnimeRanking(): Promise<BilibiliVideo[]> {
  try {
    const resp = await axios.get('https://api.bilibili.com/x/web-interface/ranking/v2', {
      params: { rid: 1, type: 'all' },
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10000
    });
    return resp.data.code === 0 ? (resp.data.data?.list || []).slice(0, 20) : [];
  } catch { return []; }
}

async function fetchBilibiliPopular(): Promise<BilibiliVideo[]> {
  try {
    const resp = await axios.get('https://api.bilibili.com/x/web-interface/popular', {
      params: { ps: 20, pn: 1 },
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10000
    });
    return resp.data.code === 0 ? (resp.data.data?.list || []) : [];
  } catch { return []; }
}

async function fetchVideoHotComments(aid: number, limit = 5): Promise<BilibiliComment[]> {
  try {
    const resp = await axios.get('https://api.bilibili.com/x/v2/reply/main', {
      params: { type: 1, oid: aid, mode: 3, ps: limit },
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10000
    });
    return resp.data.code === 0 ? (resp.data.data?.replies || []) : [];
  } catch { return []; }
}

// ===== NGA API =====

interface NgaPost {
  tid: number;
  fid: number;
  author: string;
  subject: string;
  postdate: number;
  replies: number;
  lastpost: number;
}

// NGA 游戏论坛 fid 映射
const NGA_FORUMS: Record<string, number> = {
  '原神': 476,
  '崩坏：星穹铁道': 650,
  '崩坏3': 341,
  '绝区零': 710,
  '鸣潮': 694,
  '明日方舟': 447
};

async function fetchNgaHotPosts(fid: number, limit = 10): Promise<NgaPost[]> {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const resp = await axios.post(
      'https://ngabbs.com/app_api.php?__lib=subject&__act=list',
      new URLSearchParams({ fid: String(fid), recommend: '0' }).toString(),
      {
        headers: {
          'X-User-Agent': 'NGA_skull/6.0.5(iPhone10,3;iOS 12.0.1)',
          'Cookie': `guestJs=${timestamp}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );
    if (resp.data.code !== 0 || !resp.data.result?.data) return [];
    return (resp.data.result.data || []).filter((p: NgaPost) => p.tid).slice(0, limit);
  } catch (error) {
    console.error(`[Community] NGA fid=${fid} error:`, (error as Error).message);
    return [];
  }
}

// ===== Xiaoheihe API (hkey signing — ported from RSSHub) =====

const XHH_DICT = 'JKMNPQRTX1234OABCDFG56789';

function xhhMd5(str: string): Buffer {
  return crypto.createHash('md5').update(str).digest();
}

function xhhConvertByte(v: number): number {
  return v & 0x80 ? 0xff & ((v << 1) ^ 0x1b) : v << 1;
}

function xhhC1(v: number): number { return xhhC2(xhhC3(xhhConvertByte(v))); }
function xhhC2(v: number): number { return xhhC3(xhhConvertByte(v)); }
function xhhC3(v: number): number { return xhhConvertByte(v) ^ v; }
function xhhC0(v: number): number { return xhhC1(v) ^ xhhC2(v) ^ xhhC3(v); }

function xhhChecksum(data: number[]): number {
  return (xhhC0(data[0]) ^ xhhC1(data[1]) ^ xhhC2(data[2]) ^ xhhC3(data[3])
    + xhhC3(data[0]) ^ xhhC0(data[1]) ^ xhhC1(data[2]) ^ xhhC2(data[3])
    + xhhC2(data[0]) ^ xhhC3(data[1]) ^ xhhC0(data[2]) ^ xhhC1(data[3])
    + xhhC1(data[0]) ^ xhhC2(data[1]) ^ xhhC3(data[2]) ^ xhhC0(data[3])) % 100;
}

function calculateXhhUrl(url: string, timestamp?: number, nonce?: string): string {
  timestamp ||= Math.trunc(Date.now() / 1000);
  nonce ||= xhhMd5(Math.random().toString()).toString('hex').toUpperCase();

  const { pathname } = new URL(url);
  const ts = timestamp + 1;
  const u = '/' + pathname.split('/').filter(Boolean).join('/') + '/';

  const nonceHash = xhhMd5((nonce + XHH_DICT).replaceAll(/\D/g, '')).toString('hex').toLowerCase();
  const rnd = xhhMd5(ts + u + nonceHash).toString('hex').replaceAll(/\D/g, '').slice(0, 9).padEnd(9, '0');

  let key = '';
  for (let c = +rnd, i = 0; i < 5; i++) {
    const idx = c % XHH_DICT.length;
    c = Math.trunc(c / XHH_DICT.length);
    key += XHH_DICT[idx];
  }

  const suffix = xhhChecksum([...key].slice(-4).map(c => c.codePointAt(0)!)).toString().padStart(2, '0');

  const urlObj = new URL(url);
  const query = `hkey=${key}${suffix}&_time=${timestamp}&nonce=${nonce}`;
  urlObj.search += urlObj.search ? '&' + query : '?' + query;
  return urlObj.toString();
}

interface XhhNewsItem {
  linkid: number;
  title: string;
  description: string;
  modify_at: number;
}

async function fetchXiaoheiheNews(limit = 20): Promise<XhhNewsItem[]> {
  try {
    const feedUrl = calculateXhhUrl(
      `https://api.xiaoheihe.cn/bbs/app/feeds/news?os_type=web&app=heybox&client_type=mobile&version=999.0.3&x_client_type=web&x_os_type=Mac&x_app=heybox&heybox_id=-1&appid=900018355&offset=0&limit=${limit}`
    );

    const resp = await axios.get(feedUrl, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10000
    });

    if (resp.data.status !== 'ok') {
      console.error('[Community] Xiaoheihe API failed:', resp.data.msg);
      return [];
    }
    return (resp.data.result?.links || resp.data.result?.list || [])
      .filter((item: XhhNewsItem) => item.linkid !== undefined);
  } catch (error) {
    console.error('[Community] Xiaoheihe error:', (error as Error).message);
    return [];
  }
}

// NGA post content (comments)
interface NgaPostContent {
  content: string;
  author: string;
}

async function fetchNgaPostContent(tid: number): Promise<NgaPostContent[]> {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const resp = await axios.post(
      'https://ngabbs.com/app_api.php?__lib=post&__act=list',
      new URLSearchParams({ tid: String(tid) }).toString(),
      {
        headers: {
          'X-User-Agent': 'NGA_skull/6.0.5(iPhone10,3;iOS 12.0.1)',
          'Cookie': `guestJs=${timestamp}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );
    if (resp.data.code !== 0 || !resp.data.result) return [];
    return (resp.data.result || []).map((p: NgaPostContent) => ({
      content: (p.content || '').replace(/\[.*?\]/g, '').slice(0, 200),
      author: p.author || ''
    }));
  } catch {
    return [];
  }
}

// ===== Parallel comment fetching =====

async function fetchCommentsParallel(
  aids: number[], concurrency: number, limitPerVideo: number
): Promise<BilibiliComment[][]> {
  const results: BilibiliComment[][] = new Array(aids.length);
  for (let i = 0; i < aids.length; i += concurrency) {
    const batch = aids.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((aid, j) => fetchVideoHotComments(aid, limitPerVideo).then(c => { results[i + j] = c; }))
    );
    // Log failures
    batchResults.forEach((r, j) => {
      if (r.status === 'rejected') console.error(`[Community] Comments error for aid=${aids[i + j]}:`, r.reason);
    });
    if (i + concurrency < aids.length) await new Promise(r => setTimeout(r, 500));
  }
  return results;
}

async function fetchNgaCommentsParallel(
  tids: number[], concurrency: number
): Promise<NgaPostContent[][]> {
  const results: NgaPostContent[][] = new Array(tids.length);
  for (let i = 0; i < tids.length; i += concurrency) {
    const batch = tids.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((tid, j) => fetchNgaPostContent(tid).then(c => { results[i + j] = c; }))
    );
    batchResults.forEach((r) => {
      if (r.status === 'rejected') console.error(`[Community] NGA comment error:`, r.reason);
    });
    if (i + concurrency < tids.length) await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

// ===== ACG Keywords =====

const ACG_KEYWORDS = [
  '原神', '崩坏', '绝区零', '鸣潮', '明日方舟', '终末地', '异环',
  '星穹铁道', '崩坏3', '米哈游', '鹰角', '库洛', 'miHoYo', 'HoYoverse',
  '二次元', 'ACG', '番剧', '动画', 'PV', '角色', '抽卡', '卡池',
  '游戏', '手游', '端游', '新游', '公测', '开服', '周年庆',
  '联动', '版本更新', '前瞻', '直播', '实机', '演示',
  '少女前线', '碧蓝航线', '阴阳师', '第五人格', '永劫无间',
  '王者荣耀', '英雄联盟', 'VALORANT', 'CS2', 'Dota2'
];

function isAcgRelated(text: string): boolean {
  return ACG_KEYWORDS.some(kw => text.includes(kw));
}

// ===== Sentiment Analysis (AI-powered with keyword fallback) =====

interface SentimentResult {
  label: 'positive' | 'negative' | 'neutral';
  score: number; // -1 to 1
}

// Keyword-based fallback (fast, no API cost)
const POSITIVE_WORDS: [string, number][] = [
  ['yyds', 3], ['永远的神', 3], ['绝绝子', 2], ['太强了', 2], ['封神', 2],
  ['好看', 1], ['牛', 1], ['强', 1], ['神', 1], ['绝了', 1], ['爱了', 1],
  ['太棒', 1], ['期待', 1], ['喜欢', 1], ['推荐', 1], ['必抽', 1], ['必买', 1],
  ['惊艳', 1], ['完美', 1], ['顶级', 1], ['优秀', 1], ['感动', 1], ['泪目', 1],
  ['破防', 1], ['帅', 1], ['美', 1], ['可爱', 1], ['厉害', 1], ['炸裂', 1],
  ['天花板', 1], ['无敌', 1], ['好评', 1], ['值得', 1], ['真香', 1], ['上头', 1],
  ['良心', 1], ['福利', 1], ['白嫖', 1], ['赚了', 1], ['天才', 1], ['杰作', 1]
];

const NEGATIVE_WORDS: [string, number][] = [
  ['太差了', 2], ['不推荐', 2], ['避雷', 2], ['别买', 2], ['别抽', 2],
  ['浪费时间', 2],
  ['烂', 1], ['差', 1], ['坑', 1], ['失望', 1], ['垃圾', 1], ['退', 1],
  ['恶心', 1], ['抄袭', 1], ['敷衍', 1], ['摆烂', 1], ['崩', 1], ['劝退', 1],
  ['骗', 1], ['亏', 1], ['贵', 1], ['肝', 1], ['氪', 1], ['暗改', 1],
  ['背刺', 1], ['吃相', 1], ['无聊', 1], ['重复', 1], ['换皮', 1], ['缝合', 1],
  ['拉胯', 1], ['离谱', 1], ['过分', 1], ['讨厌', 1], ['无语', 1], ['怒', 1],
  ['喷', 1], ['骂', 1], ['卸载', 1], ['退款', 1], ['后悔', 1], ['跑路', 1],
  ['凉了', 1]
];

function keywordSentiment(text: string): SentimentResult {
  const lower = text.toLowerCase();
  let posScore = 0;
  let negScore = 0;
  for (const [word, weight] of POSITIVE_WORDS) {
    if (lower.includes(word)) posScore += weight;
  }
  for (const [word, weight] of NEGATIVE_WORDS) {
    if (lower.includes(word)) negScore += weight;
  }
  const total = posScore + negScore;
  if (total === 0) return { label: 'neutral', score: 0 };
  const score = (posScore - negScore) / total;
  if (posScore > negScore) return { label: 'positive', score };
  if (negScore > posScore) return { label: 'negative', score };
  return { label: 'neutral', score: 0 };
}

// AI-powered sentiment analysis (handles sarcasm, irony, context)
interface AiProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function resolveAiConfig(): AiProviderConfig | null {
  const preferred = (process.env.AI_PROVIDER || '').toLowerCase();
  if (preferred === 'mimo' && process.env.MIMO_API_KEY) {
    return { apiKey: process.env.MIMO_API_KEY, baseUrl: process.env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1', model: process.env.MIMO_MODEL || 'mimo-v2.5' };
  }
  if (preferred === 'deepseek' && process.env.DEEPSEEK_API_KEY) {
    return { apiKey: process.env.DEEPSEEK_API_KEY, baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com', model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash' };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { apiKey: process.env.OPENROUTER_API_KEY, baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v3.2' };
  }
  return null;
}

async function aiSentimentBatch(texts: string[]): Promise<SentimentResult[]> {
  const config = resolveAiConfig();
  if (!config || texts.length === 0) return texts.map(() => ({ label: 'neutral', score: 0 }));

  const joined = texts.map((t, i) => `[${i}] ${t.slice(0, 200)}`).join('\n');

  const systemPrompt = `你是游戏社区情绪分析专家。分析以下评论的真实情绪，特别注意：
- 反讽/阴阳怪气（如"真好玩"实际是嘲讽）
- 表面正面但实际负面的表达
- 表面中立但隐含情绪的表达
- NGA/贴吧特有的讽刺文化

对每条评论输出一行，格式：序号:label:score
label = positive/negative/neutral
score = -1.0 到 1.0 的浮点数（负数=负面，正数=正面）

只输出分析结果，不要解释。`;

  try {
    const resp = await axios.post(
      `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: joined }
        ],
        temperature: 0.1,
        max_tokens: 1000
      },
      {
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 25000
      }
    );

    const content = resp.data?.choices?.[0]?.message?.content || '';
    return parseAiSentimentResponse(content, texts.length);
  } catch (error) {
    console.error('[Community] AI sentiment error:', (error as Error).message);
    return texts.map(() => ({ label: 'neutral', score: 0 }));
  }
}

function parseAiSentimentResponse(content: string, expectedCount: number): SentimentResult[] {
  const results: SentimentResult[] = [];
  for (let i = 0; i < expectedCount; i++) {
    const line = content.split('\n').find(l => l.startsWith(`${i}:`));
    if (line) {
      const parts = line.split(':');
      const label = (parts[1] || 'neutral').trim() as SentimentResult['label'];
      const score = parseFloat(parts[2]) || 0;
      results.push({ label: ['positive', 'negative', 'neutral'].includes(label) ? label : 'neutral', score: Math.max(-1, Math.min(1, score)) });
    } else {
      results.push({ label: 'neutral', score: 0 });
    }
  }
  return results;
}

// Main sentiment function: keyword first, AI for ambiguous cases
async function analyzeSentiment(text: string): Promise<SentimentResult> {
  const keyword = keywordSentiment(text);
  // If keyword gives a clear signal, use it (fast, no API cost)
  if (keyword.score > 0.3 || keyword.score < -0.3) return keyword;
  // For ambiguous/neutral results, try AI (handles sarcasm)
  const [ai] = await aiSentimentBatch([text]);
  return ai || keyword;
}

// Batch analyze NGA posts with AI (more efficient)
async function analyzeNgaBatch(posts: { subject: string; replies: number }[]): Promise<SentimentResult[]> {
  const titles = posts.map(p => p.subject);
  const keywordResults = titles.map(t => keywordSentiment(t));

  // Collect ambiguous cases for AI analysis
  const ambiguousIndices: number[] = [];
  const ambiguousTexts: string[] = [];
  keywordResults.forEach((r, i) => {
    if (r.score > -0.3 && r.score < 0.3) {
      ambiguousIndices.push(i);
      ambiguousTexts.push(titles[i]);
    }
  });

  if (ambiguousTexts.length > 0) {
    const aiResults = await aiSentimentBatch(ambiguousTexts);
    ambiguousIndices.forEach((origIdx, aiIdx) => {
      keywordResults[origIdx] = aiResults[aiIdx] || keywordResults[origIdx];
    });
  }

  return keywordResults;
}

// ===== Topic Classification =====

const TOPIC_KEYWORDS: Record<string, string[]> = {
  character: ['角色', '人物', '建模', '立绘', '技能', '命座', '专武', '角色演示', '新角色', '角色PV', '立绘'],
  gameplay: ['玩法', '战斗', '操作', '难度', '副本', '深渊', '关卡', '配队', '手法', '输出', '实机', '演示', '攻略'],
  event: ['活动', '福利', '奖励', '联动', '周年', '版本', '卡池', '限定', '复刻', 'UP', '前瞻', '直播'],
  update: ['更新', '平衡', '调整', '削弱', '增强', '修复', '补丁', '优化', '改动', '版本更新', '爆料', '泄露'],
  community: ['二创', '同人', '梗', '社区', 'UP主', '整活', '名场面', '搞笑', '日常', '翻唱', 'MV', 'cosplay']
};

function classifyTopic(text: string): string {
  const lower = text.toLowerCase();
  let best = 'other';
  let bestScore = 0;
  for (const [cat, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const score = keywords.filter(kw => lower.includes(kw)).length;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}

// ===== Heat Score (with time decay) =====

function calculateHeatScore(
  stats: { view?: number; like?: number; reply?: number; commentLikes?: number },
  publishedAt: number, // unix timestamp
  replies?: number
): number {
  const now = Date.now() / 1000;
  const ageHours = Math.max(0.1, (now - publishedAt) / 3600);

  // Time decay: 24h half-life
  const decay = Math.pow(0.5, ageHours / 24);

  const viewScore = Math.min(40, ((stats.view || 0) / 500000) * 40);
  const likeScore = Math.min(30, ((stats.like || 0) / 50000) * 30);
  const commentScore = Math.min(30, ((stats.commentLikes || 0) / 2000) * 30);
  const raw = viewScore + likeScore + commentScore;

  return Math.round(Math.min(100, raw * decay));
}

function calculateNgaHeatScore(post: NgaPost): number {
  const now = Date.now() / 1000;
  const ageHours = Math.max(0.1, (now - post.postdate) / 3600);
  const decay = Math.pow(0.5, ageHours / 24);

  const replyScore = Math.min(60, ((post.replies || 0) / 50) * 60);
  // Recency boost: newer posts get a bonus
  const recencyBoost = ageHours < 6 ? 20 : ageHours < 24 ? 10 : 0;

  return Math.round(Math.min(100, (replyScore + recencyBoost) * decay));
}

// ===== Dedup (cross-source, title similarity) =====

function normalizeTitle(title: string): string {
  return title
    .replace(/[【】\[\]「」『』《》""''!！?？。，、~\s]+/g, '')
    .toLowerCase();
}

function isDuplicate(title: string, seenTitles: Set<string>): boolean {
  const normalized = normalizeTitle(title);
  if (seenTitles.has(normalized)) return true;

  // Check substring similarity (60% overlap)
  for (const existing of seenTitles) {
    if (normalized.length < 4 || existing.length < 4) continue;
    const shorter = normalized.length < existing.length ? normalized : existing;
    const longer = normalized.length < existing.length ? existing : normalized;
    if (longer.includes(shorter) && shorter.length / longer.length > 0.6) {
      return true;
    }
  }

  seenTitles.add(normalized);
  return false;
}

// ===== Main Aggregation =====

export async function aggregateCommunityTopics(): Promise<CommunityTopic[]> {
  console.log('[Community] Fetching from Bilibili + NGA + Xiaoheihe...');

  // Fetch all sources in parallel
  const [gameRanking, animeRanking, popular, ngaResults, xhhResults] = await Promise.allSettled([
    fetchBilibiliGameRanking(),
    fetchBilibiliAnimeRanking(),
    fetchBilibiliPopular(),
    fetchAllNgaHotPosts(),
    fetchXiaoheiheNews(15)
  ]);

  const topics: CommunityTopic[] = [];
  const seenTitles = new Set<string>();

  // === Bilibili topics ===
  if (ngaResults.status === 'fulfilled' || gameRanking.status === 'fulfilled' || animeRanking.status === 'fulfilled' || popular.status === 'fulfilled') {
    const allBiliVideos: BilibiliVideo[] = [];
    if (gameRanking.status === 'fulfilled') allBiliVideos.push(...gameRanking.value);
    if (animeRanking.status === 'fulfilled') allBiliVideos.push(...animeRanking.value);
    if (popular.status === 'fulfilled') allBiliVideos.push(...popular.value);

    // Dedup by aid
    const seenAids = new Set<number>();
    const deduped = allBiliVideos.filter(v => {
      if (seenAids.has(v.aid)) return false;
      seenAids.add(v.aid);
      return true;
    });

    const acgVideos = deduped.filter(v => isAcgRelated(`${v.title} ${v.desc || ''} ${v.tname || ''}`));
    console.log(`[Community] Bilibili ACG videos: ${acgVideos.length}`);

    acgVideos.sort((a, b) => (b.stat?.view || 0) - (a.stat?.view || 0));
    const topVideos = acgVideos.slice(0, 12);

    // Fetch comments in parallel (batches of 4)
    const commentResults = await fetchCommentsParallel(topVideos.map(v => v.aid), 4, 5);

    // Batch AI sentiment analysis for all comment sets
    const allCommentTexts = commentResults.map(comments =>
      comments.slice(0, 3).map(c => c.content?.message || '').filter(Boolean).join('\n')
    );
    const allSentiments = await aiSentimentBatch(allCommentTexts);

    for (let i = 0; i < topVideos.length; i++) {
      const video = topVideos[i];
      const comments = commentResults[i];

      if (comments.length === 0) continue;

      const sentiment = allSentiments[i] || keywordSentiment(video.title);
      const totalLikes = comments.reduce((sum, c) => sum + (c.like || 0), 0);
      const topComment = comments.reduce((best, c) =>
        (c.like || 0) > (best.like || 0) ? c : best, comments[0]);

      const heatScore = calculateHeatScore(
        { view: video.stat?.view, like: video.stat?.like, commentLikes: totalLikes },
        video.pubdate || 0
      );

      const title = video.title;
      if (isDuplicate(title, seenTitles)) continue;

      topics.push({
        id: `bilibili-${video.aid}`,
        title,
        sentiment: sentiment.label,
        sentimentScore: sentiment.score,
        heatScore,
        category: classifyTopic(`${title} ${video.desc || ''}`),
        source: 'bilibili',
        trend: [heatScore],
        summary: topComment.content?.message?.slice(0, 120) || video.desc?.slice(0, 120) || title,
        url: `https://www.bilibili.com/video/${video.bvid}`,
        publishedAt: new Date((video.pubdate || 0) * 1000).toISOString()
      });
    }
  }

  // === NGA topics ===
  if (ngaResults.status === 'fulfilled') {
    const ngaTopics = ngaResults.value;
    console.log(`[Community] NGA posts: ${ngaTopics.length}`);

    // Filter duplicates first
    const validPosts = ngaTopics.filter(p => !isDuplicate(p.subject, seenTitles));

    // Fetch comments for top 15 posts (by reply count) for better sentiment analysis
    const topPosts = validPosts.sort((a, b) => (b.replies || 0) - (a.replies || 0)).slice(0, 15);

    // Fetch NGA comments in parallel (batches of 5)
    const ngaCommentResults = await fetchNgaCommentsParallel(topPosts.map(p => p.tid), 5);

    // Batch AI analysis for NGA posts
    const ngaTexts = topPosts.map((post, i) => {
      const comments = ngaCommentResults[i];
      if (comments.length > 0) {
        return [post.subject, ...comments.slice(0, 3).map(c => c.content)].join('\n');
      }
      return post.subject;
    });
    const ngaSentiments = await aiSentimentBatch(ngaTexts);

    for (let i = 0; i < topPosts.length; i++) {
      const post = topPosts[i];
      const heatScore = calculateNgaHeatScore(post);
      const comments = ngaCommentResults[i];
      const sentiment = ngaSentiments[i] || keywordSentiment(post.subject);

      topics.push({
        id: `nga-${post.tid}`,
        title: post.subject,
        sentiment: sentiment.label,
        sentimentScore: sentiment.score,
        heatScore,
        category: classifyTopic(post.subject),
        source: 'nga',
        trend: [heatScore],
        summary: comments.length > 0
          ? comments[0].content.slice(0, 100)
          : `${post.replies} 条回复 · ${post.author}`,
        url: `https://nga.178.com/read.php?tid=${post.tid}`,
        publishedAt: new Date(post.postdate * 1000).toISOString()
      });
    }
  }

  // === Xiaoheihe topics ===
  if (xhhResults.status === 'fulfilled') {
    const xhhTopics = xhhResults.value;
    console.log(`[Community] Xiaoheihe news: ${xhhTopics.length}`);

    for (const item of xhhTopics) {
      if (!isAcgRelated(item.title)) continue;
      if (isDuplicate(item.title, seenTitles)) continue;

      const sentiment = await analyzeSentiment(item.title);

      topics.push({
        id: `xhh-${item.linkid}`,
        title: item.title,
        sentiment: sentiment.label,
        sentimentScore: sentiment.score,
        heatScore: 50, // Xiaoheihe doesn't provide explicit heat metrics
        category: classifyTopic(item.title),
        source: 'xiaoheihe',
        trend: [50],
        summary: item.description?.slice(0, 120) || item.title,
        url: `https://xiaoheihe.cn/bbs/app/share/detail/${item.linkid}`,
        publishedAt: new Date((item.modify_at || 0) * 1000).toISOString()
      });
    }
  }

  // Sort by heat score
  topics.sort((a, b) => b.heatScore - a.heatScore);

  console.log(`[Community] Total topics: ${topics.length}`);
  return topics;
}

async function fetchAllNgaHotPosts(): Promise<NgaPost[]> {
  const allPosts: NgaPost[] = [];
  const fids = Object.values(NGA_FORUMS);

  for (const fid of fids) {
    const posts = await fetchNgaHotPosts(fid, 8);
    allPosts.push(...posts);
    await new Promise(r => setTimeout(r, 500));
  }

  return allPosts;
}

