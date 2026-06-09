import { useState, useMemo } from 'react';
import { Activity } from 'lucide-react';
import { importanceLabel } from '../utils/format';
import { GAME_CATEGORIES, FOLLOW_CATEGORIES } from '../constants';
import { Donut } from './Donut';

export interface InsightsPageProps {
  gameCategoryCounts: Record<string, number>;
  followCategoryCounts: Record<string, number>;
  importanceCounts: Record<string, number>;
  hourlyTrend: Array<{ hour: string; count: number }>;
}

export function InsightsPage({ gameCategoryCounts, followCategoryCounts, importanceCounts, hourlyTrend }: InsightsPageProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const maxCount = Math.max(...hourlyTrend.map(d => d.count), 1);

  // Generate SVG path for line chart — guard against empty/single-point data
  const points = useMemo(() => {
    if (hourlyTrend.length <= 1) return [];
    return hourlyTrend.map((d, i) => ({
      x: (i / (hourlyTrend.length - 1)) * 100,
      y: 100 - (d.count / maxCount) * 80
    }));
  }, [hourlyTrend, maxCount]);
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = pathD ? pathD + ` L 100 100 L 0 100 Z` : '';

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
          <h3>近 24 小时情报趋势</h3>
          <div className="trend-chart">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="trend-svg">
              <defs>
                <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--pink)" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="var(--blue)" stopOpacity="0.05" />
                </linearGradient>
              </defs>
              <path d={areaD} fill="url(#trendGradient)" />
              <path d={pathD} fill="none" stroke="var(--pink)" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
              {points.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={hoveredIndex === i ? "1.5" : "0.8"}
                  fill="var(--pink)"
                  opacity={hoveredIndex === i ? 1 : 0.8}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{ cursor: 'pointer', transition: 'r 0.15s, opacity 0.15s' }}
                />
              ))}
            </svg>
            {hoveredIndex !== null && (
              <div
                className="trend-tooltip"
                style={{
                  left: `${points[hoveredIndex].x}%`,
                  top: `${points[hoveredIndex].y - 5}%`
                }}
              >
                {hourlyTrend[hoveredIndex].hour}: {hourlyTrend[hoveredIndex].count} 条
              </div>
            )}
          </div>
          <div className="trend-labels">
            {hourlyTrend.filter((_, i) => i % 4 === 0).map((data, index) => (
              <span key={index}>{data.hour}</span>
            ))}
          </div>
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
    </section>
  );
}
