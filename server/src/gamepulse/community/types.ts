export type SentimentLabel = 'positive' | 'negative' | 'neutral' | 'unknown';
export type SentimentStatus = 'completed' | 'failed' | 'unavailable' | 'legacy';
export type SentimentMethod = 'ai' | 'keyword' | 'none';

export const COMMUNITY_SOURCES = ['bilibili', 'nga', 'xiaoheihe'] as const;
export const COMMUNITY_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
export type CommunitySource = typeof COMMUNITY_SOURCES[number];

export interface CommunitySourceResult {
  source: CommunitySource;
  status: 'healthy' | 'degraded' | 'failed';
  error?: string;
}

export interface CommunitySourceHealth extends CommunitySourceResult {
  checkedAt: number;
  lastSuccessAt: number | null;
}

export interface CommunityTopic {
  id: string;
  title: string;
  sentiment: SentimentLabel;
  sentimentScore: number;
  sentimentStatus: SentimentStatus;
  sentimentMethod: SentimentMethod;
  sentimentConfidence: number;
  sentimentVersion: string | null;
  sentimentAnalyzedAt: string | null;
  heatScore: number;
  rawHeatScore: number;
  category: string;
  source: string;
  trend: number[];
  rawHeatTrend: number[];
  summary: string;
  url: string;
  publishedAt: string;
}

export type ExistingCommunityTopic = Pick<
  CommunityTopic,
  | 'sentiment'
  | 'sentimentScore'
  | 'sentimentStatus'
  | 'sentimentMethod'
  | 'sentimentConfidence'
  | 'sentimentVersion'
  | 'sentimentAnalyzedAt'
>;
