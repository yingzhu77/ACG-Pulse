/**
 * Shared API DTOs consumed by the client.
 *
 * Runtime validation still lives in server route schemas. Keep this file in
 * sync whenever a route response or query contract changes.
 */

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

export interface SourcePreviewDraft {
  name: string;
  type: string;
  game: string;
  url?: string | null;
  uid?: string | null;
  route?: string | null;
  isOfficial?: boolean;
  followed?: boolean;
  enabled?: boolean;
  priority?: number;
  config?: string | null;
  limit?: number;
}

export interface SourcePreviewItem {
  title: string;
  url: string;
  authorName: string | null;
  publishedAt: string | null;
  itemKind: string;
  contentSnippet: string;
}

export interface SourcePreviewResponse {
  ok: true;
  source: {
    name: string;
    type: string;
    game: string;
  };
  items: SourcePreviewItem[];
  totalFetched: number;
  truncated: boolean;
  warnings: string[];
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
  heatScore: number; // aggregated display heat trend, not rawHeatScore
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

export interface HotSearchItem {
  title: string;
  heat: number;
  source: 'bilibili' | 'weibo';
  url: string;
  tags: string[];
}
