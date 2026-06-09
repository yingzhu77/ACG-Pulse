import { useMemo } from 'react';
import { Flame, Gauge } from 'lucide-react';
import type { PublicStats, Source, Story } from '../services/api';
import { sourceNames } from '../constants';
import { importanceLabel, formatClock } from '../utils/format';
import { estimateDedupRate } from '../utils/stats';
import { SourceIcon } from './SourceIcon';
import { SummaryMetric } from './SummaryMetric';
import { Tag } from './Tag';

export interface SummaryColumnProps {
  stats: PublicStats | null;
  sources: Source[];
  health: { healthy: number; failed: number; unknown: number };
  stories: Story[];
}

export function SummaryColumn(props: SummaryColumnProps) {
  // 今日热门：高重要性 + 官方源的故事
  const hotStories = useMemo(() => {
    return props.stories
      .filter(s => s.importance === 'high' && s.sources.some(src => src.isOfficial))
      .slice(0, 8);
  }, [props.stories]);

  return (
    <aside className="summary-column">
      <section className="glass-panel summary-panel">
        <div className="panel-heading compact">
          <h2>今日摘要</h2>
          <Gauge className="h-4 w-4" />
        </div>
        <div className="metric-grid">
          <SummaryMetric label="情报总数" value={props.stats?.total || 0} note="公开主流" tone="blue" />
          <SummaryMetric label="高重要情报" value={props.stats?.high || 0} note="high" tone="pink" />
          <SummaryMetric label="今日热门" value={hotStories.length} note="官方高重要" tone="cyan" />
          <SummaryMetric label="活跃来源" value={props.sources.length} note={`${props.health.healthy} 健康`} tone="amber" />
          <SummaryMetric label="AI 处理条数" value={props.stats?.total || 0} note="含规则兜底" tone="violet" />
          <SummaryMetric label="去重率" value={estimateDedupRate(props.stories)} suffix="%" note="多源合并" tone="green" />
        </div>
      </section>

      {hotStories.length > 0 && (
        <section className="glass-panel hot-panel">
          <div className="panel-heading compact">
            <h2><Flame className="h-4 w-4" style={{ display: 'inline', verticalAlign: '-3px', marginRight: 4 }} />今日热门</h2>
          </div>
          <div className="notice-list">
            {hotStories.map(story => (
              <a key={story.id} href={story.sources[0]?.url} target="_blank" rel="noreferrer" className="notice-row">
                <span>{formatClock(story.publishedAt || story.createdAt)}</span>
                <b>{sourceNames[story.sources[0]?.sourceType] || story.sources[0]?.sourceName || '来源'}</b>
                <em>{story.canonicalTitle}</em>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="glass-panel notice-panel">
        <div className="panel-heading compact">
          <h2>实时通知</h2>
        </div>
        <div className="notice-list">
          {props.stories.slice(0, 20).map(story => (
            <a key={story.id} href={story.sources[0]?.url} target="_blank" rel="noreferrer" className="notice-row">
              <span>{formatClock(story.publishedAt || story.createdAt)}</span>
              <b>{sourceNames[story.sources[0]?.sourceType] || story.sources[0]?.sourceName || '来源'}</b>
              <em>{story.canonicalTitle}</em>
              <Tag tone={story.importance}>{importanceLabel(story.importance)}</Tag>
            </a>
          ))}
        </div>
      </section>

      <section className="glass-panel health-panel">
        <div className="panel-heading compact">
          <h2>源健康</h2>
          <span>{props.health.healthy}/{props.sources.length} 正常</span>
        </div>
        <div className="health-list" style={{ maxHeight: '240px', overflowY: 'auto' }}>
          {props.sources.map(source => (
            <div
              key={source.id}
              className="health-row"
              title={`${source.name}\n类型: ${source.type}\n游戏: ${source.game || '通用'}\n状态: ${source.healthStatus}\n最后成功: ${source.lastSuccessAt ? new Date(source.lastSuccessAt).toLocaleString('zh-CN') : '未同步'}${source.lastError ? '\n错误: ' + source.lastError.slice(0, 100) : ''}`}
            >
              <span className="source-square">
                <SourceIcon type={source.type} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source.name}</b>
                <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>
                  {source.lastSuccessAt ? new Date(source.lastSuccessAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未同步'}
                </span>
              </div>
              <div className="health-track">
                <span style={{ width: source.healthStatus === 'healthy' ? '100%' : '42%' }} />
              </div>
              <em style={{ color: source.healthStatus === 'healthy' ? '#6bd69a' : '#ff6b6b', fontSize: '0.7rem' }}>{source.healthStatus === 'healthy' ? '✓' : '✗'}</em>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
