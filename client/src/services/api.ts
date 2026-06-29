import type { OperationalMetrics } from '../../../shared/operations';
import type {
  AnalysisQueueOverview,
  CommunityInsights,
  FeedItem,
  HotSearchItem,
  ItemFilters,
  Paginated,
  PublicStats,
  ReportFilters,
  ReportResponse,
  Source,
  StoriesResponse
} from '../../../shared/api';

export type { OperationalMetrics, OperationalStatus } from '../../../shared/operations';
export type {
  Analysis,
  AnalysisQueueOverview,
  AnalysisQueueTask,
  CommunityHeatPoint,
  CommunityInsights,
  CommunitySourceShare,
  CommunityTopTopic,
  FeedItem,
  HotSearchItem,
  ItemFilters,
  Keyword,
  Paginated,
  PublicStats,
  ReportFilters,
  ReportResponse,
  ReportSummary,
  Source,
  Story,
  StoryFacets,
  StoriesResponse
} from '../../../shared/api';

const API_BASE = '/api';
const TOKEN_KEY = 'game_pulse_admin_token';

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

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
