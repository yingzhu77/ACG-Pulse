/**
 * Hot search adapter for Bilibili, Weibo, and Douban.
 * Fetches trending topics from multiple platforms.
 */

import axios from 'axios';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export interface HotSearchItem {
  title: string;
  heat: number;
  source: 'bilibili' | 'weibo' | 'douban';
  url: string;
}

// Bilibili hot search (热搜)
async function fetchBilibiliHot(): Promise<HotSearchItem[]> {
  try {
    const response = await axios.get(
      'https://api.bilibili.com/x/web-interface/wbi/search/square',
      {
        params: { limit: 50 },
        headers: { 'User-Agent': getRandomUserAgent() },
        timeout: 10000
      }
    );

    if (response.data.code !== 0 || !response.data.data?.trending?.list) {
      return [];
    }

    return response.data.data.trending.list.map((item: any) => ({
      title: item.keyword || item.show_name || '',
      heat: item.heat_score || item.heat_id || 0,
      source: 'bilibili' as const,
      url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(item.keyword || '')}`
    }));
  } catch (error) {
    console.error('[HotSearch] Bilibili error:', (error as Error).message);
    return [];
  }
}

// Bilibili popular videos (热门投稿)
async function fetchBilibiliPopular(): Promise<HotSearchItem[]> {
  try {
    const response = await axios.get(
      'https://api.bilibili.com/x/web-interface/popular',
      {
        params: { ps: 20, pn: 1 },
        headers: { 'User-Agent': getRandomUserAgent() },
        timeout: 10000
      }
    );

    if (response.data.code !== 0 || !response.data.data?.list) {
      return [];
    }

    return response.data.data.list.map((item: any) => ({
      title: item.title || '',
      heat: item.stat?.view || 0,
      source: 'bilibili' as const,
      url: `https://www.bilibili.com/video/${item.bvid}`
    }));
  } catch (error) {
    console.error('[HotSearch] Bilibili popular error:', (error as Error).message);
    return [];
  }
}

// Weibo hot search
async function fetchWeiboHot(): Promise<HotSearchItem[]> {
  try {
    const response = await axios.get(
      'https://weibo.com/ajax/side/hotSearch',
      {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Referer': 'https://weibo.com/',
          'Accept': 'application/json'
        },
        timeout: 10000
      }
    );

    if (response.data?.ok !== 1 || !response.data?.data?.realtime) {
      return [];
    }

    return response.data.data.realtime.map((item: any) => ({
      title: item.note || item.word || '',
      heat: item.num || 0,
      source: 'weibo' as const,
      url: `https://s.weibo.com/weibo?q=${encodeURIComponent('#' + (item.note || item.word) + '#')}`
    }));
  } catch (error) {
    console.error('[HotSearch] Weibo error:', (error as Error).message);
    return [];
  }
}

// Douban movie hot list
async function fetchDoubanHot(): Promise<HotSearchItem[]> {
  try {
    const response = await axios.get(
      'https://movie.douban.com/j/search_subjects',
      {
        params: {
          type: 'movie',
          tag: '热门',
          page_limit: 20,
          page_start: 0
        },
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Referer': 'https://movie.douban.com/',
          'Accept': 'application/json'
        },
        timeout: 10000
      }
    );

    if (!response.data?.subjects) {
      return [];
    }

    return response.data.subjects.map((item: any) => ({
      title: item.title || '',
      heat: Math.round((parseFloat(item.rate) || 0) * 100000),
      source: 'douban' as const,
      url: item.url || `https://movie.douban.com/subject/${item.id}`
    }));
  } catch (error) {
    console.error('[HotSearch] Douban error:', (error as Error).message);
    return [];
  }
}

// Hot topic keywords for classification
const HOT_TOPIC_KEYWORDS: Record<string, string[]> = {
  game: [
    '原神', '崩坏', '绝区零', '鸣潮', '明日方舟', '终末地', '异环',
    '王者荣耀', '和平精英', '英雄联盟', 'VALORANT', 'CS2', 'Dota2',
    '任天堂', 'PlayStation', 'Xbox', 'Steam', 'Switch', 'PS5', 'NS2',
    '游戏', '手游', '端游', '网游', '单机', '独立游戏', '实机', '演示',
    '版本', '更新', '前瞻', '直播', 'PV', '预告', '角色', '新角色'
  ],
  anime: [
    '动画', '番剧', '新番', '剧场版', '漫画', '轻小说', 'VTuber',
    'Vtuber', '虚拟主播', '二次元', 'ACG', 'cosplay', '动漫',
    'OP', 'ED', '主题曲', '先行版', '字幕', '汉化', '番'
  ],
  ai: [
    'GPT', 'Claude', 'Gemini', '大模型', 'AI', '人工智能', 'OpenAI',
    'DeepSeek', '智谱', '通义', '文心', 'Copilot', 'Midjourney',
    '豆包', 'Kimi', 'Llama', '模型'
  ],
  movie: [
    '电影', '电视剧', '综艺', '导演', '演员', '票房', '上映',
    'Netflix', 'Disney', '漫威', 'DC', '定档', '首播', '开播',
    '剧集', '影院', '票房', '评分', '豆瓣', '影视', '热播'
  ]
};

// Classify hot topic by keywords
export function classifyHotTopic(title: string): string[] {
  const tags: string[] = [];
  const titleLower = title.toLowerCase();

  for (const [tag, keywords] of Object.entries(HOT_TOPIC_KEYWORDS)) {
    if (keywords.some(kw => titleLower.includes(kw.toLowerCase()))) {
      tags.push(tag);
    }
  }

  return tags.length > 0 ? tags : ['other'];
}

// Fetch all hot search from all sources
export async function fetchAllHotSearch(): Promise<HotSearchItem[]> {
  const [bilibiliHot, bilibiliPopular, weibo, douban] = await Promise.allSettled([
    fetchBilibiliHot(),
    fetchBilibiliPopular(),
    fetchWeiboHot(),
    fetchDoubanHot()
  ]);

  const allItems: HotSearchItem[] = [];

  if (bilibiliHot.status === 'fulfilled') {
    allItems.push(...bilibiliHot.value);
  }
  if (bilibiliPopular.status === 'fulfilled') {
    allItems.push(...bilibiliPopular.value);
  }
  if (weibo.status === 'fulfilled') {
    allItems.push(...weibo.value);
  }
  if (douban.status === 'fulfilled') {
    allItems.push(...douban.value);
  }

  // Sort by heat (descending)
  allItems.sort((a, b) => b.heat - a.heat);

  return allItems;
}
