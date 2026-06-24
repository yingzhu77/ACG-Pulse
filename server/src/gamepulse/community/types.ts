export type SentimentLabel = 'positive' | 'negative' | 'neutral' | 'unknown';
export type SentimentStatus = 'completed' | 'failed' | 'unavailable' | 'legacy';
export type SentimentMethod = 'ai' | 'keyword' | 'none';

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
  category: string;
  source: string;
  trend: number[];
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
