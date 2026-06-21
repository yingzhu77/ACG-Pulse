import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUp, Clock3, Flame, TrendingUp } from 'lucide-react';
import { SENTIMENT_TYPES, TOPIC_CATEGORIES, COMMUNITY_SOURCES } from '../constants';
import type { CommunityTopic } from '../constants';
import { cn } from '../lib/utils';
import { CommunityTopicCard } from './CommunityTopicCard';
import { SummaryMetric } from './SummaryMetric';
import { onCommunityUpdate } from '../services/socket';

export function CommunityPanel() {
  const pageSize = 30;
  const [topics, setTopics] = useState<CommunityTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [sentimentFilter, setSentimentFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sort, setSort] = useState<'heat' | 'latest'>('heat');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [summary, setSummary] = useState<{ sentimentCounts: { positive: number; negative: number; neutral: number }; avgHeat: number } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const panelTopRef = useRef<HTMLDivElement | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  useEffect(() => {
    const panelTop = panelTopRef.current;
    if (!panelTop) return;

    const observer = new IntersectionObserver(
      ([entry]) => setShowScrollTop(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(panelTop);
    return () => observer.disconnect();
  }, []);

  const scrollToTop = useCallback(() => {
    panelTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const fetchData = useCallback((nextPage = 1, append = false) => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(nextPage), limit: String(pageSize), sort });
    if (sentimentFilter) params.set('sentiment', sentimentFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    if (sourceFilter) params.set('source', sourceFilter);

    fetch(`/api/community/topics?${params}`, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        const incoming: CommunityTopic[] = data.data || [];
        setTopics(current => append
          ? [...new Map([...current, ...incoming].map(topic => [topic.id, topic])).values()]
          : incoming);
        setSummary(data.summary || null);
        setPage(data.pagination?.page || nextPage);
        setTotal(data.pagination?.total || 0);
        setTotalPages(data.pagination?.totalPages || 0);
        // If server reports background refresh in progress, keep polling
        if (data.isRefreshing) {
          setIsRefreshing(true);
        } else {
          setIsRefreshing(false);
        }
      })
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!append) {
          setTopics([]);
          setSummary(null);
          setTotal(0);
          setTotalPages(0);
        }
        setError(err.message || '加载失败');
      })
      .finally(() => {
        if (requestControllerRef.current !== controller) return;
        setLoading(false);
        setLoadingMore(false);
      });
  }, [categoryFilter, sentimentFilter, sort, sourceFilter]);

  useEffect(() => { fetchData(1, false); }, [fetchData]);

  // Poll while server reports background refresh in progress
  useEffect(() => {
    if (!isRefreshing) return;
    const timer = setTimeout(() => fetchData(1, false), 5000);
    return () => clearTimeout(timer);
  }, [isRefreshing, fetchData]);

  // Debounced socket refresh — prevents rapid-fire refetches
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    return onCommunityUpdate(() => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchData(1, false), 3000);
    });
  }, [fetchData]);

  const sentimentCounts = summary?.sentimentCounts || { positive: 0, negative: 0, neutral: 0 };
  const avgHeat = summary?.avgHeat || 0;
  const hasMore = page < totalPages;

  return (
    <>
      <section className="glass-panel community-panel">
        <div ref={panelTopRef} className="community-top-sentinel" aria-hidden="true" />
      <div className="panel-heading">
        <span className="community-result-count" aria-live="polite">
          已展示 {topics.length} / {total}
        </span>
        <h2>社区热点风向</h2>
        {loading && topics.length === 0 ? (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>加载中...</span>
        ) : isRefreshing ? (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>刷新中...</span>
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
        <div className="community-sort-control" aria-label="话题排序方式">
          <button
            type="button"
            className={cn(sort === 'heat' && 'active')}
            onClick={() => setSort('heat')}
            aria-pressed={sort === 'heat'}
          >
            <Flame className="h-3 w-3" />
            热度优先
          </button>
          <button
            type="button"
            className={cn(sort === 'latest' && 'active')}
            onClick={() => setSort('latest')}
            aria-pressed={sort === 'latest'}
          >
            <Clock3 className="h-3 w-3" />
            最新发布
          </button>
        </div>
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
        {loading && topics.length === 0 ? (
          <div className="empty-state">正在获取社区热点...</div>
        ) : error && topics.length === 0 ? (
          <div className="empty-state" style={{ cursor: 'pointer' }} onClick={() => fetchData(1, false)}>
            加载失败: {error} · 点击重试
          </div>
        ) : topics.length === 0 ? (
          <div className="empty-state">暂无匹配的社区话题</div>
        ) : (
          <>
            {isRefreshing && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-soft)', padding: '0 0 8px', textAlign: 'center' }}>
                数据正在后台刷新...
              </div>
            )}
            {topics.map(topic => (
              <CommunityTopicCard key={topic.id} topic={topic} />
            ))}
          </>
        )}
      </div>
      {topics.length > 0 && (
        <div className="community-load-more">
          {hasMore ? (
            <button
              type="button"
              className="community-load-more-button"
              onClick={() => fetchData(page + 1, true)}
              disabled={loadingMore || loading}
            >
              {loadingMore ? '加载中...' : `加载更多（剩余 ${Math.max(0, total - topics.length)} 条）`}
            </button>
          ) : (
            <span>已显示全部 {total} 条话题</span>
          )}
          {error && topics.length > 0 && <span className="community-load-error">加载失败，请重试</span>}
        </div>
      )}
      </section>
      <button
        type="button"
        className={cn('community-scroll-top', showScrollTop && 'is-visible')}
        onClick={scrollToTop}
        aria-label="回到社区风向顶部"
        title="回到顶部"
        tabIndex={showScrollTop ? 0 : -1}
      >
        <ArrowUp className="h-5 w-5" />
      </button>
    </>
  );
}
