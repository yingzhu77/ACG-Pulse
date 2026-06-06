export type SourceType = 'rss' | 'rsshub' | 'bilibili_video' | 'official_site' | 'trend';

export type FeedItemKind = 'official_post' | 'creator_video' | 'trend' | 'forum_thread';

export type AnalysisCategory =
  | 'announcement'
  | 'event'
  | 'version'
  | 'character'
  | 'pv'
  | 'game_music'
  | 'music'
  | 'community'
  | 'enforcement'
  | 'creator_video'
  | 'trailer'
  | 'movie_trailer'
  | 'other';

export type Importance = 'low' | 'medium' | 'high';

export type Visibility = 'public' | 'muted' | 'hidden';

export interface SourceConfig {
  itemKind?: FeedItemKind;
  route?: string;
  routeFallbacks?: string[];
  rssHubRoutes?: string[];
  rssHubBaseUrls?: string[];
  fetchTimeoutMs?: number;
  directApiFallback?: boolean;
  includeDynamic?: boolean;
  tags?: string[];
  authorUrl?: string;
}

export interface RawFeedItem {
  externalId?: string;
  itemKind: FeedItemKind;
  title: string;
  content: string;
  url: string;
  authorName?: string;
  authorUrl?: string;
  coverUrl?: string;
  publishedAt?: Date;
}

export interface NormalizedAnalysis {
  category: AnalysisCategory;
  importance: Importance;
  visibility: Visibility;
  confidence: number;
  summary: string;
  reason: string;
  dedupKeywords: string[];
}

export interface LLMAnalyzeInput {
  title: string;
  content: string;
  game: string;
  sourceName: string;
  sourceType: string;
  sourceIsOfficial?: boolean;
  itemKind: string;
  publishedAt?: Date | null;
}

export interface LLMProviderResult {
  analysis: NormalizedAnalysis;
  provider: string;
  model: string;
}

// --- Prisma-compatible where clause types ---

/** A single Prisma-style where condition (leaf or compound). */
export type PrismaWhereCondition = Record<string, unknown>;

/** A Prisma-style where clause that supports AND/OR/NOT composition. */
export interface PrismaWhereClause {
  AND?: PrismaWhereClause[];
  OR?: PrismaWhereClause[];
  NOT?: PrismaWhereClause | PrismaWhereClause[];
  [field: string]: unknown;
}

// --- Input types for storyAggregation ---

/** Source select shape used by public routes. */
export interface SourceSelectForPublic {
  id: string;
  name: string;
  type: string;
  game: string;
  isOfficial: boolean;
  followed?: boolean;
  healthStatus: string;
}

/** Analysis shape included with feed items. */
export interface AnalysisRelation {
  id: string;
  status: string;
  category: string | null;
  importance: string;
  visibility: string;
  confidence: number;
  summary: string | null;
  reason: string | null;
  dedupKeywords: string | null;
  provider: string | null;
  model: string | null;
  error: string | null;
  analyzedAt: Date | null;
}

/** FeedItem with source and analysis relations, as returned by Prisma includes. */
export interface FeedItemWithRelations {
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
  publishedAt: Date | null;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  source: SourceSelectForPublic;
  analysis: AnalysisRelation | null;
}
