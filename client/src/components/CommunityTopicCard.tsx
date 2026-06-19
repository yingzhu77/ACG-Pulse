import { memo } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, Flame } from 'lucide-react';
import { cn } from '../lib/utils';
import type { CommunityTopic } from '../constants';
import { TOPIC_CATEGORIES, COMMUNITY_SOURCES } from '../constants';
import { Tag } from './Tag';
import { SentimentBadge } from './SentimentBadge';
import { HeatScoreRing } from './HeatScoreRing';
import { SentimentTrendMini } from './SentimentTrendMini';

interface CommunityTopicCardProps {
  topic: CommunityTopic;
}

export const CommunityTopicCard = memo(function CommunityTopicCard({ topic }: CommunityTopicCardProps) {
  const sentimentColor =
    topic.sentiment === 'positive' ? 'var(--green)' :
    topic.sentiment === 'negative' ? 'var(--pink)' : 'var(--cyan)';

  return (
    <motion.article
      className={cn('story-card', 'community-card')}
      style={{ borderLeftColor: sentimentColor }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="community-card-ring">
        <HeatScoreRing score={topic.heatScore} size={48} />
      </div>

      <div className="story-body">
        <div className="story-meta-line">
          <SentimentBadge sentiment={topic.sentiment} />
          <Tag>{TOPIC_CATEGORIES[topic.category] || topic.category}</Tag>
          <span className="source-pill">{COMMUNITY_SOURCES[topic.source] || topic.source}</span>
        </div>

        <a href={topic.url} target="_blank" rel="noreferrer" className="story-title">
          {topic.title}
        </a>
        <p className="story-summary">{topic.summary}</p>

        <div className="story-footer">
          <span className="hot-heat-badge">
            <Flame className="h-3 w-3" />
            热度 {topic.heatScore}
          </span>
          <SentimentTrendMini data={topic.trend} color={sentimentColor} />
        </div>
      </div>

      <div className="story-actions">
        <a
          className="source-jump-button"
          href={topic.url}
          target="_blank"
          rel="noreferrer"
          aria-label="查看原文"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </motion.article>
  );
});
