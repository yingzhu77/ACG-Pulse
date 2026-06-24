import { cn } from '../lib/utils';

interface SentimentBadgeProps {
  sentiment: 'positive' | 'negative' | 'neutral' | 'unknown';
  status: 'completed' | 'failed' | 'unavailable' | 'legacy';
  confidence: number;
}

const LABELS = { positive: '正面', negative: '负面', neutral: '中性', unknown: '未判断' };

export function SentimentBadge({ sentiment, status, confidence }: SentimentBadgeProps) {
  const uncertain = status !== 'completed' || confidence < 0.65;
  return (
    <span
      className={cn('tag', `tag-sentiment-${sentiment}`, uncertain && 'is-uncertain')}
      title={status === 'completed' ? undefined : '当前未获得可靠的情感判断'}
    >
      {LABELS[sentiment]}
      {status === 'completed' && confidence < 0.65 ? ' · 判断不确定' : ''}
    </span>
  );
}
