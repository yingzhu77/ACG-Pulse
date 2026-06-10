export const FOLLOW_CATEGORIES: Record<string, string> = {
  music: '最新音乐',
  trailer: 'ACG 内容',
  movie_trailer: '电影预告',
  creator_video: '创作者视频'
};

export const GAME_CATEGORIES: Record<string, string> = {
  announcement: '官方公告',
  event: '活动资讯',
  version: '版本更新',
  character: '角色情报',
  pv: 'PV 影像',
  game_music: '游戏EP',
  community: '社区热点',
  other: '其他'
};

export const categories: Record<string, string> = { ...FOLLOW_CATEGORIES, ...GAME_CATEGORIES };

export const sourceNames: Record<string, string> = {
  bilibili_video: 'B站',
  rsshub: '米游社',
  rss: 'RSS',
  official_site: '官网',
  trend: '趋势'
};

export const gameAccents = ['#ff5b8a', '#6d8cff', '#45c4ff', '#f6a03d', '#4ecf98', '#9e7cff', '#f1d15b'];

export type Theme = 'light' | 'dark';

export const sourceIconUrls: Record<string, string> = {
  bilibili_video: 'https://www.bilibili.com/favicon.ico',
  rsshub: 'https://www.miyoushe.com/favicon.ico'
};

export const gameIconUrls: Record<string, string> = {
  原神: 'https://ys.mihoyo.com/favicon.ico',
  崩坏3: 'https://www.bh3.com/favicon.ico',
  '崩坏：星穹铁道': 'https://sr.mihoyo.com/favicon.ico',
  绝区零: 'https://zzz.mihoyo.com/favicon.ico',
  鸣潮: 'https://mc.kurogames.com/favicon.ico',
  明日方舟: 'https://ak.hypergryph.com/favicon.ico',
  '明日方舟：终末地': 'https://hypergryph.com/favicon.ico',
  异环: 'https://yh.wanmei.com/favicon.ico'
};

// ===== Community Hot Topics =====

export type ViewMode = 'feed' | 'insights' | 'community';

export const SENTIMENT_TYPES: Record<string, string> = {
  positive: '正面',
  negative: '负面',
  neutral: '中性'
};

export const TOPIC_CATEGORIES: Record<string, string> = {
  gameplay: '玩法讨论',
  character: '角色话题',
  event: '活动争议',
  update: '版本更新',
  lore: '剧情世界观',
  community: '社区事件',
  esports: '赛事竞技',
  other: '其他'
};

export const COMMUNITY_SOURCES: Record<string, string> = {
  bilibili: 'B站',
  nga: 'NGA',
  xiaoheihe: '小黑盒'
};

export interface CommunityTopic {
  id: string;
  title: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentimentScore: number;
  heatScore: number;
  category: string;
  source: string;
  trend: number[];
  summary: string;
  url: string;
  publishedAt: string;
}


