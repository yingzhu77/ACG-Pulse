import { Activity } from 'lucide-react';
import { importanceLabel } from '../utils/format';
import { Donut } from './Donut';

export interface InsightsPageProps {
  categoryCounts: Record<string, number>;
  importanceCounts: Record<string, number>;
  hourlyTrend: Array<{ hour: string; count: number }>;
}

export function InsightsPage({ categoryCounts, importanceCounts, hourlyTrend }: InsightsPageProps) {
  const maxCount = Math.max(...hourlyTrend.map(d => d.count), 1);
  return (
    <section className="glass-panel insights-page">
      <div className="panel-heading">
        <h2>数据洞察</h2>
        <Activity className="h-4 w-4" />
      </div>
      <div className="insight-strip">
        <div className="glass-panel chart-panel">
          <h3>AI 分类分布</h3>
          <Donut counts={categoryCounts} />
        </div>
        <div className="glass-panel chart-panel">
          <h3>重要性分布</h3>
          <Donut counts={importanceCounts} tones={['#ff5b8a', '#f6a03d', '#6bd69a']} labelFor={importanceLabel} />
        </div>
        <div className="glass-panel trend-panel">
          <h3>近 24 小时情报趋势</h3>
          <div className="trend-lines" aria-hidden>
            {hourlyTrend.map((data, index) => (
              <span key={index} style={{ height: `${Math.max(5, (data.count / maxCount) * 100)}%` }} title={`${data.hour}: ${data.count} 条`} />
            ))}
          </div>
          <div className="trend-labels">
            {hourlyTrend.filter((_, i) => i % 4 === 0).map((data, index) => (
              <span key={index}>{data.hour}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
