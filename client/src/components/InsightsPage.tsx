import { useState, useMemo, useEffect, useCallback } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { importanceLabel } from '../utils/format';
import { GAME_CATEGORIES, FOLLOW_CATEGORIES, COMMUNITY_SOURCES } from '../constants';
import { Donut } from './Donut';
import { InteractiveTrendChart, type TrendChartDatum } from './InteractiveTrendChart';
import { onCommunityUpdate } from '../services/socket';
import { publicApi, type CommunityInsights, type CommunityHeatPoint } from '../services/api';

export interface InsightsPageProps {
  gameCategoryCounts: Record<string, number>;
  followCategoryCounts: Record<string, number>;
  importanceCounts: Record<string, number>;
  hourlyTrend: Array<{ hour: string; count: number }>;
}

const SOURCE_COLORS: Record<string, string> = {
  bilibili: 'var(--pink)',
  nga: 'var(--blue)',
  xiaoheihe: 'var(--orange)',
};

const EMPTY_HEAT_TREND: CommunityHeatPoint[] = [];

export function InsightsPage({ gameCategoryCounts, followCategoryCounts, importanceCounts, hourlyTrend }: InsightsPageProps) {
  // Community insights state
  const [ci, setCi] = useState<CommunityInsights | null>(null);
  const [ciLoading, setCiLoading] = useState(true);
  const [ciError, setCiError] = useState('');

  const fetchInsights = useCallback(() => {
    setCiLoading(true);
    setCiError('');
    publicApi.getCommunityInsights()
      .then(data => setCi(data))
      .catch(err => { setCi(null); setCiError(err.message || '加载失败'); })
      .finally(() => setCiLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(fetchInsights, 0);
    return () => window.clearTimeout(timer);
  }, [fetchInsights]);

  // Poll while background refresh is in progress
  useEffect(() => {
    if (!ci?.meta.isRefreshing) return;
    const t = setTimeout(fetchInsights, 5000);
    return () => clearTimeout(t);
  }, [ci?.meta.isRefreshing, fetchInsights]);

  // Socket-triggered refresh
  useEffect(() => onCommunityUpdate(() => setTimeout(fetchInsights, 3000)), [fetchInsights]);

  const hourlyTrendData = useMemo<TrendChartDatum[]>(() => hourlyTrend.map(point => ({
    label: point.hour,
    value: point.count,
  })), [hourlyTrend]);

  // Community sparkline points
  const ciTrend = ci?.heatTrend || EMPTY_HEAT_TREND;
  const communityTrendData = useMemo<TrendChartDatum[]>(() => ciTrend.map(point => ({
    label: `第 ${point.index + 1} 次采集`,
    value: point.heatScore,
    detail: `${point.topicCount} 话题`,
  })), [ciTrend]);

  const topMaxHeat = ci?.topTopics.length ? Math.max(...ci.topTopics.map(t => t.heatScore), 1) : 1;

  return (
    <section className="glass-panel insights-page">
      <div className="panel-heading">
        <h2>数据洞察</h2>
        <Activity className="h-4 w-4" />
      </div>
      <div className="insight-strip">
        <div className="glass-panel chart-panel">
          <h3>游戏情报分布</h3>
          <Donut counts={gameCategoryCounts} labelFor={(k) => GAME_CATEGORIES[k] || k} />
        </div>
        <div className="glass-panel chart-panel">
          <h3>关注投稿分布</h3>
          <Donut counts={followCategoryCounts} labelFor={(k) => FOLLOW_CATEGORIES[k] || k} />
        </div>
        <div className="glass-panel trend-panel">
          <InteractiveTrendChart
            title="近 24 小时情报趋势"
            data={hourlyTrendData}
            valueLabel="情报"
            unit=" 条"
            color="var(--pink)"
          />
        </div>
      </div>
      <div className="importance-bar">
        <h3>重要性分布</h3>
        <div className="importance-bars">
          {(['high', 'medium', 'low'] as const).map(level => {
            const count = importanceCounts[level] || 0;
            const total = Object.values(importanceCounts).reduce((a, b) => a + b, 0);
            const percent = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={level} className="importance-bar-item">
                <span className="importance-label">{importanceLabel(level)}</span>
                <div className="importance-bar-track">
                  <div
                    className={`importance-bar-fill ${level}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span className="importance-count">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== 社区风向 ===== */}
      <div className="community-insights">
        <h3>
          社区风向
          {ci?.meta.isRefreshing && <Loader2 className="h-3 w-3 ci-spin" />}
          {ci?.meta.lastUpdated && (
            <span className="ci-meta">
              {ci.meta.isStale ? '数据更新中' : '已更新'}
            </span>
          )}
        </h3>

        {ciLoading ? (
          <div className="ci-empty"><Loader2 className="h-5 w-5 ci-spin" /><span>加载中…</span></div>
        ) : ciError ? (
          <div className="ci-empty ci-error">{ciError}</div>
        ) : !ci || ci.meta.totalTopics === 0 ? (
          <div className="ci-empty">暂无社区数据，等待下次采集</div>
        ) : (
          <div className="ci-grid">
            {/* Top Topics Bar Chart */}
            <div className="glass-panel ci-card">
              <h4>热门话题 Top 8</h4>
              <div className="ci-bar-list">
                {ci.topTopics.map((t, i) => (
                  <a
                    key={t.id}
                    className="ci-bar-row"
                    href={t.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${t.title}\n热度 ${t.heatScore} · ${COMMUNITY_SOURCES[t.source] || t.source}`}
                  >
                    <span className="ci-bar-rank">{i + 1}</span>
                    <span className="ci-bar-title">{t.title}</span>
                    <span className="ci-bar-track">
                      <span
                        className="ci-bar-fill"
                        style={{
                          width: `${(t.heatScore / topMaxHeat) * 100}%`,
                          background: SOURCE_COLORS[t.source] || 'var(--text-soft)'
                        }}
                      />
                    </span>
                    <span className="ci-bar-heat">{t.heatScore}</span>
                  </a>
                ))}
              </div>
            </div>

            {/* Source Share + Heat Trend side-by-side on desktop */}
            <div className="ci-right-col">
              {/* Source Share */}
              <div className="glass-panel ci-card">
                <h4>来源热度占比</h4>
                <div className="ci-source-bar-wrap">
                  <div className="ci-source-bar">
                    {ci.sourceShare.map(s => (
                      <span
                        key={s.source}
                        className="ci-source-segment"
                        style={{
                          width: `${s.percent}%`,
                          background: SOURCE_COLORS[s.source] || 'var(--text-soft)'
                        }}
                        title={`${COMMUNITY_SOURCES[s.source] || s.source}: ${s.percent}%`}
                      />
                    ))}
                  </div>
                  <div className="ci-source-legend">
                    {ci.sourceShare.map(s => (
                      <span key={s.source} className="ci-source-legend-item">
                        <i style={{ background: SOURCE_COLORS[s.source] || 'var(--text-soft)' }} />
                        {COMMUNITY_SOURCES[s.source] || s.source}
                        <em>{s.percent}%</em>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Heat Trend Sparkline */}
              <div className="glass-panel ci-card">
                <InteractiveTrendChart
                  title="近期热度趋势"
                  data={communityTrendData}
                  valueLabel="平均热度"
                  color="var(--cyan)"
                  compact
                  headingLevel={4}
                  edgeLabels={['较早', '最新']}
                  emptyText="趋势数据不足"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
