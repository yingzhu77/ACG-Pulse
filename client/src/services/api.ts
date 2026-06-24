import type { OperationalMetrics } from '../../../shared/operations';

export type { OperationalMetrics, OperationalStatus } from '../../../shared/operations';

const API_BASE = '/api';
const TOKEN_KEY = 'game_pulse_admin_token';

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

export interface Source {
  id: string;
  name: string;
  type: string;
  game: string;
  url: string | null;
  uid: string | null;
  avatar: string | null;
  route: string | null;
  config: string | null;
  isOfficial: boolean;
  followed: boolean;
  enabled: boolean;
  priority: number;
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'failed';
  lastSuccessAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  _count?: { feedItems: number };
}

export interface Keyword {
  id: string;
  text: string;
  category: string | null;
  isActive: boolean;
}

export interface Analysis {
  id: string;
  status: 'pending' | 'completed' | 'failed';
  category: string | null;
  importance: 'low' | 'medium' | 'high';
  visibility: 'public' | 'muted' | 'hidden';
  confidence: number;
  summary: string | null;
  reason: string | null;
  dedupKeywords: string[];
  provider: string | null;
  model: string | null;
  error: string | null;
  analyzedAt: string | null;
}

export interface AnalysisQueueTask {
  id: string;
  feedItemId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  provider: string | null;
  model: string | null;
  durationMs: number | null;
  nextRunAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
  feedItem: {
    id: string;
    title: string;
    game: string;
    createdAt: string;
    source: {
      name: string;
    };
  };
}

export interface AnalysisQueueOverview {
  counts: Record<string, number>;
  processing: boolean;
  recentTasks: AnalysisQueueTask[];
}

export interface FeedItem {
  id: string;
  sourceId: string;
  externalId: string | null;
  itemKind: string;
  game: string;
  title: string;
  content: string;
  url: string;
  authorName: string | null;
  authorUrl: string | null;
  coverUrl: string | null;
  sourceType: string;
  hidden: boolean;
  publishedAt: string | null;
  fetchedAt: string;
  createdAt: string;
  source: Pick<Source, 'id' | 'name' | 'type' | 'game' | 'isOfficial' | 'healthStatus'>;
  analysis: Analysis | null;
}

export interface Story {
  id: string;
  canonicalTitle: string;
  game: string;
  category: string | null;
  importance: 'low' | 'medium' | 'high';
  visibility: 'public' | 'muted';
  summary: string | null;
  reason: string | null;
  coverUrl: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  createdAt: string;
  sourceCount: number;
  itemCount: number;
  sources: Array<{
    itemId: string;
    sourceId: string;
    sourceName: string;
    sourceType: string;
    isOfficial: boolean;
    url: string;
    title: string;
    publishedAt: string | null;
  }>;
  items: FeedItem[];
}

export interface PublicStats {
  total: number;
  today: number;
  high: number;
  byGame: Record<string, number>;
  byKind: Record<string, number>;
  sourceHealth: Record<string, number>;
  hourlyTrend: Array<{ hour: string; count: number }>;
  byCategory: Record<string, number>;
  byFollowCategory: Record<string, number>;
  byImportance: Record<string, number>;
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface StoryFacets {
  byGame: Record<string, number>;
  byCategory: Record<string, number>;
  byFollowCategory: Record<string, number>;
  byImportance: Record<string, number>;
}

export interface StoriesResponse {
  data: Story[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  facets: StoryFacets;
}

export type ItemFilters = {
  page?: number;
  limit?: number;
  game?: string | string[];
  sourceId?: string;
  itemKind?: string;
  category?: string | string[];
  importance?: string | string[];
  visibility?: string;
  official?: string;
  q?: string;
  followGroup?: string;
  sourceUid?: string | string[];
  includeFacets?: boolean;
};

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      throw new UnauthorizedError();
    }
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

const REPEATED_QUERY_KEYS = new Set(['game', 'category', 'importance', 'sourceUid']);

function withParams(endpoint: string, params?: Record<string, unknown>): string {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === '') return;
    if (Array.isArray(value)) {
      value.map(String).filter(Boolean).forEach(v => search.append(key, v));
      return;
    }
    const str = String(value);
    if (REPEATED_QUERY_KEYS.has(key) && str.includes(',')) {
      str.split(',').filter(Boolean).forEach(v => search.append(key, v));
      return;
    }
    search.set(key, str);
  });
  const query = search.toString();
  return query ? `${endpoint}?${query}` : endpoint;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY)
};

export interface ReportFilters {
  type?: 'daily' | 'weekly';
  date?: string;
  weekStart?: string;
  game?: string;
  category?: string;
  importance?: string;
}

export interface ReportSummary {
  total: number;
  high: number;
  medium: number;
  low: number;
  games: string[];
  categories: string[];
}

export interface ReportResponse {
  meta: {
    type: 'daily' | 'weekly';
    dateRange: { start: string; end: string };
    game?: string;
    category?: string;
    importance?: string;
  };
  stories: Story[];
  summary: ReportSummary;
}

export interface CommunityTopTopic {
  id: string;
  title: string;
  heatScore: number;
  sentiment: string;
  source: string;
  category: string;
  url: string;
}

export interface CommunitySourceShare {
  source: string;
  count: number;
  heatScore: number;
  percent: number;
}

export interface CommunityHeatPoint {
  index: number;
  heatScore: number;
  topicCount: number;
}

export interface CommunityInsights {
  topTopics: CommunityTopTopic[];
  sourceShare: CommunitySourceShare[];
  heatTrend: CommunityHeatPoint[];
  meta: {
    totalTopics: number;
    lastUpdated: string | null;
    isStale: boolean;
    isRefreshing: boolean;
  };
}

export const publicApi = {
  getItems: (filters?: ItemFilters) => request<Paginated<FeedItem>>(withParams('/public/items', filters)),
  getStories: (filters?: ItemFilters) => request<StoriesResponse>(withParams('/public/stories', filters)),
  getStats: () => request<PublicStats>('/public/stats'),
  getSources: () => request<Source[]>('/public/sources'),
  getHotSearch: (filters?: { tag?: string; limit?: number }) => request<{ data: HotSearchItem[]; total: number; lastUpdated: string }>(withParams('/public/hot-search', filters)),
  getCommunityInsights: () => request<CommunityInsights>('/community/insights', { cache: 'no-store' }),
  getDailyReport: (filters?: ReportFilters) => request<ReportResponse>(withParams('/public/reports/daily', filters as Record<string, unknown>)),
  getWeeklyReport: (filters?: ReportFilters) => request<ReportResponse>(withParams('/public/reports/weekly', filters as Record<string, unknown>)),
  exportReportUrl: (filters?: ReportFilters): string => {
    const params: Record<string, string> = {};
    if (filters?.type) params.type = filters.type;
    if (filters?.date) params.date = filters.date;
    if (filters?.weekStart) params.weekStart = filters.weekStart;
    if (filters?.game) params.game = filters.game;
    if (filters?.category) params.category = filters.category;
    if (filters?.importance) params.importance = filters.importance;
    const search = new URLSearchParams(params).toString();
    return `/api/public/reports/export${search ? `?${search}` : ''}`;
  }
};

export interface HotSearchItem {
  title: string;
  heat: number;
  source: 'bilibili' | 'weibo';
  url: string;
  tags: string[];
}

export const adminApi = {
  login: (password: string) => request<{ token: string }>('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password })
  }),
  getSources: () => request<Source[]>('/admin/sources', { headers: authHeaders() }),
  getOperationalMetrics: () => request<OperationalMetrics>('/admin/ops/metrics', { headers: authHeaders() }),
  createSource: (source: Partial<Source>) => request<Source>('/admin/sources', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(source)
  }),
  updateSource: (id: string, source: Partial<Source>) => request<Source>(`/admin/sources/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(source)
  }),
  toggleSource: (id: string) => request<Source>(`/admin/sources/${id}/toggle`, {
    method: 'PATCH',
    headers: authHeaders()
  }),
  deleteSource: (id: string) => request<void>(`/admin/sources/${id}`, {
    method: 'DELETE',
    headers: authHeaders()
  }),
  seedDefaults: () => request<{ count: number; sources: Source[] }>('/admin/sources/seed-defaults', {
    method: 'POST',
    headers: authHeaders()
  }),
  followUrl: (url: string, name?: string) => request<Source>('/admin/sources/follow-url', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ url, name })
  }),
  getItems: (params?: { page?: number; hidden?: string }) => request<Paginated<FeedItem>>(withParams('/admin/items', params), {
    headers: authHeaders()
  }),
  hideItem: (id: string, hidden: boolean) => request<FeedItem>(`/admin/items/${id}/hide`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ hidden })
  }),
  analyzeItem: (id: string) => request<FeedItem>(`/admin/items/${id}/analyze`, {
    method: 'POST',
    headers: authHeaders()
  }),
  runCheck: () => request<{ checkedSources: number; newItems: number; failedSources: number }>('/admin/check', {
    method: 'POST',
    headers: authHeaders()
  }),
  getAnalysisQueue: () => request<AnalysisQueueOverview>('/admin/analysis-queue', {
    headers: authHeaders()
  }),
  retryAnalysisTask: (id: string) => request<void>(`/admin/analysis-queue/${id}/retry`, {
    method: 'POST',
    headers: authHeaders()
  }),
  retryFailedAnalysisTasks: () => request<{ count: number }>('/admin/analysis-queue/retry-failed', {
    method: 'POST',
    headers: authHeaders()
  }),
  reanalyzeAll: (limit: number = 100) => request<{ total: number; status: string }>('/admin/reanalyze-all', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ limit })
  }),
  getSettings: () => request<Record<string, string>>('/admin/settings', { headers: authHeaders() }),
  updateSettings: (settings: Record<string, string>) => request<void>('/admin/settings', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(settings)
  })
};
