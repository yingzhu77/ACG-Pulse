/**
 * Shared types for community hot topics.
 * Source of truth for client. Server has a mirrored copy — keep in sync.
 * See server/src/gamepulse/community/types.ts
 */

export interface CommunityTopic {
  id: string;
  title: string;
  sentiment: 'positive' | 'negative' | 'neutral' | 'unknown';
  sentimentScore: number; // -1 to 1
  sentimentStatus: 'completed' | 'failed' | 'unavailable' | 'legacy';
  sentimentMethod: 'ai' | 'keyword' | 'none';
  sentimentConfidence: number; // 0 to 1
  sentimentVersion: string | null;
  sentimentAnalyzedAt: string | null;
  heatScore: number; // display ranking: 0-100 percentile within source/current candidate set
  rawHeatScore: number; // raw source-formula score for trend analysis; do not display directly
  category: string;
  source: string;
  trend: number[]; // display heatScore history
  rawHeatTrend: number[]; // rawHeatScore history for trend analysis
  summary: string;
  url: string;
  publishedAt: string;
}
