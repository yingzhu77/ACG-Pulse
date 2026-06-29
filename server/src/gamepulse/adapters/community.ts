/**
 * Community hot topics adapter.
 * Multi-source: Bilibili ranking + NGA forum + Xiaoheihe.
 * Features: sentiment analysis, time-decay heat scoring, trend tracking, dedup.
 */

import { buildXiaoheiheTopicUrl } from '../communityUrls.js';
import {
  calculateBilibiliHeat,
  calculateNgaHeat,
  calculateXiaoheiheHeat,
  normalizeHeatBySource
} from '../community/heat.js';
import { analyzeSentimentBatch, shouldReanalyzeSentiment } from '../community/sentiment.js';
import type { CommunityTopic, ExistingCommunityTopic } from '../community/types.js';
import {
  fetchBilibiliAnimeRanking,
  fetchBilibiliComments,
  fetchBilibiliGameRanking,
  fetchBilibiliPopular,
  type BilibiliVideo
} from '../community/sources/bilibili.js';
import {
  fetchAllNgaHotPosts,
  fetchNgaComments,
  type NgaPost
} from '../community/sources/nga.js';
import { fetchXiaoheiheNews } from '../community/sources/xiaoheihe.js';

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

export async function aggregateCommunityTopics(options?: {
  existingTopics?: Map<string, ExistingCommunityTopic>;
}): Promise<CommunityTopic[]> {
  const existingTopics = options?.existingTopics;
  const existingCount = existingTopics?.size ?? 0;
  console.log(`[Community] Fetching from Bilibili + NGA + Xiaoheihe... (existing: ${existingCount})`);

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

  // Track which existing topics were seen (for cleanup)
  const seenExistingIds = new Set<string>();

  // === Bilibili topics ===
  if (gameRanking.status === 'fulfilled' || animeRanking.status === 'fulfilled' || popular.status === 'fulfilled') {
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

    // Separate new vs existing videos
    const newVideos: BilibiliVideo[] = [];
    const existingVideos: BilibiliVideo[] = [];
    for (const v of topVideos) {
      const id = `bilibili-${v.aid}`;
      const existing = existingTopics?.get(id);
      if (existing && !shouldReanalyzeSentiment(existing)) {
        existingVideos.push(v);
        seenExistingIds.add(id);
      } else {
        newVideos.push(v);
      }
    }

    // Only fetch comments + AI for NEW videos
    if (newVideos.length > 0) {
      const commentResults = await fetchBilibiliComments(newVideos.map(v => v.aid), 4, 5);
      const allCommentTexts = commentResults.map(comments =>
        comments.slice(0, 3).map(c => c.content?.message || '').filter(Boolean).join('\n')
      );
      newVideos.forEach((video, index) => {
        if (!allCommentTexts[index]) allCommentTexts[index] = video.title;
      });
      const allSentiments = await analyzeSentimentBatch(allCommentTexts);

      for (let i = 0; i < newVideos.length; i++) {
        const video = newVideos[i];
        const comments = commentResults[i];

        const sentiment = allSentiments[i];
        const topComment = comments.length > 0
          ? comments.reduce((best, c) => (c.like || 0) > (best.like || 0) ? c : best, comments[0])
          : undefined;

        const rawHeatScore = calculateBilibiliHeat(
          { view: video.stat?.view, like: video.stat?.like, reply: video.stat?.reply },
          video.pubdate || 0
        );

        const title = video.title;
        if (isDuplicate(title, seenTitles)) continue;

        topics.push({
          id: `bilibili-${video.aid}`,
          title,
          sentiment: sentiment.label,
          sentimentScore: sentiment.score,
          sentimentStatus: sentiment.status,
          sentimentMethod: sentiment.method,
          sentimentConfidence: sentiment.confidence,
          sentimentVersion: sentiment.version,
          sentimentAnalyzedAt: sentiment.analyzedAt,
          heatScore: 0,
          rawHeatScore,
          category: classifyTopic(`${title} ${video.desc || ''}`),
          source: 'bilibili',
          trend: [],
          rawHeatTrend: [rawHeatScore],
          summary: topComment?.content?.message?.slice(0, 120) || video.desc?.slice(0, 120) || title,
          url: `https://www.bilibili.com/video/${video.bvid}`,
          publishedAt: new Date(((video.pubdate || 0) > 0 ? video.pubdate! : Math.floor(Date.now() / 1000)) * 1000).toISOString()
        });
      }
    }

    // For existing videos, just update heat score (skip AI)
    for (const video of existingVideos) {
      const title = video.title;
      if (isDuplicate(title, seenTitles)) continue;

      const rawHeatScore = calculateBilibiliHeat(
        { view: video.stat?.view, like: video.stat?.like, reply: video.stat?.reply },
        video.pubdate || 0
      );
      const existing = existingTopics!.get(`bilibili-${video.aid}`)!;

      topics.push({
        id: `bilibili-${video.aid}`,
        title,
        ...existing,
        heatScore: 0,
        rawHeatScore,
        category: classifyTopic(`${title} ${video.desc || ''}`),
        source: 'bilibili',
        trend: [],
        rawHeatTrend: [rawHeatScore],
        summary: video.desc?.slice(0, 120) || title,
        url: `https://www.bilibili.com/video/${video.bvid}`,
        publishedAt: new Date(((video.pubdate || 0) > 0 ? video.pubdate! : Math.floor(Date.now() / 1000)) * 1000).toISOString()
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

    // Separate new vs existing
    const newPosts: NgaPost[] = [];
    const existingPosts: NgaPost[] = [];
    for (const p of topPosts) {
      const id = `nga-${p.tid}`;
      const existing = existingTopics?.get(id);
      if (existing && !shouldReanalyzeSentiment(existing)) {
        existingPosts.push(p);
        seenExistingIds.add(id);
      } else {
        newPosts.push(p);
      }
    }

    // Only fetch comments + AI for NEW posts
    if (newPosts.length > 0) {
      const ngaCommentResults = await fetchNgaComments(newPosts.map(p => p.tid), 5);
      const ngaTexts = newPosts.map((post, i) => {
        const comments = ngaCommentResults[i];
        if (comments.length > 0) {
          return [post.subject, ...comments.slice(0, 3).map(c => c.content)].join('\n');
        }
        return post.subject;
      });
      const ngaSentiments = await analyzeSentimentBatch(ngaTexts);

      for (let i = 0; i < newPosts.length; i++) {
        const post = newPosts[i];
        const rawHeatScore = calculateNgaHeat(post);
        const comments = ngaCommentResults[i];
        const sentiment = ngaSentiments[i];

        topics.push({
          id: `nga-${post.tid}`,
          title: post.subject,
          sentiment: sentiment.label,
          sentimentScore: sentiment.score,
          sentimentStatus: sentiment.status,
          sentimentMethod: sentiment.method,
          sentimentConfidence: sentiment.confidence,
          sentimentVersion: sentiment.version,
          sentimentAnalyzedAt: sentiment.analyzedAt,
          heatScore: 0,
          rawHeatScore,
          category: classifyTopic(post.subject),
          source: 'nga',
          trend: [],
          rawHeatTrend: [rawHeatScore],
          summary: comments.length > 0
            ? comments[0].content.slice(0, 100)
            : `${post.replies} 条回复 · ${post.author}`,
          url: `https://nga.178.com/read.php?tid=${post.tid}`,
          publishedAt: new Date((post.postdate > 0 ? post.postdate : Math.floor(Date.now() / 1000)) * 1000).toISOString()
        });
      }
    }

    // For existing posts, just update heat score
    for (const post of existingPosts) {
      const rawHeatScore = calculateNgaHeat(post);
      const existing = existingTopics!.get(`nga-${post.tid}`)!;
      topics.push({
        id: `nga-${post.tid}`,
        title: post.subject,
        ...existing,
        heatScore: 0,
        rawHeatScore,
        category: classifyTopic(post.subject),
        source: 'nga',
        trend: [],
        rawHeatTrend: [rawHeatScore],
        summary: `${post.replies} 条回复 · ${post.author}`,
        url: `https://nga.178.com/read.php?tid=${post.tid}`,
        publishedAt: new Date(post.postdate * 1000).toISOString()
      });
    }
  }

  // === Xiaoheihe topics ===
  if (xhhResults.status === 'fulfilled') {
    const xhhTopics = xhhResults.value;
    console.log(`[Community] Xiaoheihe news: ${xhhTopics.length}`);

    // Separate new vs existing
    const newXhh: typeof xhhTopics = [];
    const existingXhh: typeof xhhTopics = [];
    for (const item of xhhTopics) {
      if (!isAcgRelated(item.title)) continue;
      const id = `xhh-${item.linkid}`;
      const existing = existingTopics?.get(id);
      if (existing && !shouldReanalyzeSentiment(existing)) {
        existingXhh.push(item);
        seenExistingIds.add(id);
      } else {
        newXhh.push(item);
      }
    }

    // Only do AI for new items — batch for efficiency
    const validNewXhh = newXhh.filter(item => !isDuplicate(item.title, seenTitles));
    if (validNewXhh.length > 0) {
      const xhhTexts = validNewXhh.map(item => item.title);
      const xhhSentiments = await analyzeSentimentBatch(xhhTexts);

      for (let i = 0; i < validNewXhh.length; i++) {
        const item = validNewXhh[i];
        const sentiment = xhhSentiments[i];
        const ts = (item.modify_at || 0) > 0 ? item.modify_at : Math.floor(Date.now() / 1000);
        const rawHeatScore = calculateXiaoheiheHeat(ts);

        topics.push({
          id: `xhh-${item.linkid}`,
          title: item.title,
          sentiment: sentiment.label,
          sentimentScore: sentiment.score,
          sentimentStatus: sentiment.status,
          sentimentMethod: sentiment.method,
          sentimentConfidence: sentiment.confidence,
          sentimentVersion: sentiment.version,
          sentimentAnalyzedAt: sentiment.analyzedAt,
          heatScore: 0,
          rawHeatScore,
          category: classifyTopic(item.title),
          source: 'xiaoheihe',
          trend: [],
          rawHeatTrend: [rawHeatScore],
          summary: item.description?.slice(0, 120) || item.title,
          url: buildXiaoheiheTopicUrl(item.linkid),
          publishedAt: new Date(ts * 1000).toISOString()
        });
      }
    }

    // Existing items: just keep heat score
    for (const item of existingXhh) {
      const ts = (item.modify_at || 0) > 0 ? item.modify_at : Math.floor(Date.now() / 1000);
      const existing = existingTopics!.get(`xhh-${item.linkid}`)!;
      const rawHeatScore = calculateXiaoheiheHeat(ts);
      topics.push({
        id: `xhh-${item.linkid}`,
        title: item.title,
        ...existing,
        heatScore: 0,
        rawHeatScore,
        category: classifyTopic(item.title),
        source: 'xiaoheihe',
        trend: [],
        rawHeatTrend: [rawHeatScore],
        summary: item.description?.slice(0, 120) || item.title,
        url: buildXiaoheiheTopicUrl(item.linkid),
        publishedAt: new Date(ts * 1000).toISOString()
      });
    }
  }

  // Sort by heat score
  normalizeHeatBySource(topics);
  topics.forEach(topic => {
    topic.trend = [topic.heatScore];
  });
  topics.sort((a, b) => b.heatScore - a.heatScore);

  const skipped = existingTopics ? seenExistingIds.size : 0;
  console.log(`[Community] Total topics: ${topics.length} (skipped AI for ${skipped} existing)`);
  return topics;
}
