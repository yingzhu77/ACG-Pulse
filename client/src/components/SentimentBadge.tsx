import { cn } from '../lib/utils';

interface SentimentBadgeProps {
  sentiment: 'positive' | 'negative' | 'neutral';
}

const LABELS = { positive: '正面', negative: '负面', neutral: '中性' };

export function SentimentBadge({ sentiment }: SentimentBadgeProps) {
  return <span className={cn('tag', `tag-sentiment-${sentiment}`)}>{LABELS[sentiment]}</span>;
}
