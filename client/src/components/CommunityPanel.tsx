import { useState, useMemo, useEffect } from 'react';
import { TrendingUp } from 'lucide-react';
import { SENTIMENT_TYPES, TOPIC_CATEGORIES, COMMUNITY_SOURCES } from '../constants';
import type { CommunityTopic } from '../constants';
import { cn } from '../lib/utils';
import { CommunityTopicCard } from './CommunityTopicCard';
import { SummaryMetric } from './SummaryMetric';

export function CommunityPanel() {
  const [topics, setTopics] = useState<CommunityTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sentimentFilter, setSentimentFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [summary, setSummary] = useState<{ sentimentCounts: { positive: number; negative: number; neutral: number }; avgHeat: number } | null>(null);

  const fetchData = () => {
    setLoading(true);
    setError('');
    fetch('/api/community/topics')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        setTopics(data.data || []);
        setSummary(data.summary || null);
      })
      .catch(err => {
        setTopics([]);
        setSummary(null);
        setError(err.message || '加载失败');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => {
    return topics.filter(t => {
      if (sentimentFilter && t.sentiment !== sentimentFilter) return false;
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (sourceFilter && t.source !== sourceFilter) return false;
      return true;
    });
  }, [topics, sentimentFilter, categoryFilter, sourceFilter]);

  const sentimentCounts = summary?.sentimentCounts || { positive: 0, negative: 0, neutral: 0 };
  const avgHeat = summary?.avgHeat || 0;

  return (
    <section className="glass-panel community-panel">
      <div className="panel-heading">
        <h2>社区热点风向</h2>
        {loading ? (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>加载中...</span>
        ) : (
          <TrendingUp className="h-4 w-4" />
        )}
      </div>

      <div className="community-stats-strip">
        <SummaryMetric label="正面话题" value={sentimentCounts.positive} note="positive" tone="green" />
        <SummaryMetric label="负面话题" value={sentimentCounts.negative} note="negative" tone="pink" />
        <SummaryMetric label="中性话题" value={sentimentCounts.neutral} note="neutral" tone="cyan" />
        <SummaryMetric label="平均热度" value={avgHeat} note="0-100" tone="orange" />
      </div>

      <div className="community-filter-bar">
        <div className="community-filter-group">
          <span className="filter-label">情感</span>
          {Object.entries(SENTIMENT_TYPES).map(([key, label]) => (
            <button
              key={key}
              className={cn('hot-tag', sentimentFilter === key && 'active')}
              onClick={() => setSentimentFilter(sentimentFilter === key ? '' : key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="community-filter-group">
          <span className="filter-label">分类</span>
          {Object.entries(TOPIC_CATEGORIES).slice(0, 5).map(([key, label]) => (
            <button
              key={key}
              className={cn('hot-tag', categoryFilter === key && 'active')}
              onClick={() => setCategoryFilter(categoryFilter === key ? '' : key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="community-filter-group">
          <span className="filter-label">来源</span>
          {Object.entries(COMMUNITY_SOURCES).slice(0, 4).map(([key, label]) => (
            <button
              key={key}
              className={cn('hot-tag', sourceFilter === key && 'active')}
              onClick={() => setSourceFilter(sourceFilter === key ? '' : key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="community-topic-list">
        {loading ? (
          <div className="empty-state">正在获取社区热点...</div>
        ) : error ? (
          <div className="empty-state" style={{ cursor: 'pointer' }} onClick={fetchData}>
            加载失败: {error} · 点击重试
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">暂无匹配的社区话题</div>
        ) : (
          filtered.map((topic, index) => (
            <CommunityTopicCard key={topic.id} topic={topic} index={index} />
          ))
        )}
      </div>
    </section>
  );
}
