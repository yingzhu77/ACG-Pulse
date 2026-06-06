import { Flame, ExternalLink } from 'lucide-react';
import type { HotSearchItem } from '../services/api';

export interface HotSearchPanelProps {
  items: HotSearchItem[];
  loading: boolean;
}

export function HotSearchPanel({ items, loading }: HotSearchPanelProps) {
  if (loading) {
    return (
      <section className="glass-panel hot-search-panel">
        <div className="panel-heading">
          <h2>热搜</h2>
          <Flame className="h-4 w-4" />
        </div>
        <div className="empty-state">加载中...</div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="glass-panel hot-search-panel">
        <div className="panel-heading">
          <h2>热搜</h2>
          <Flame className="h-4 w-4" />
        </div>
        <div className="empty-state">暂无热搜内容</div>
      </section>
    );
  }

  return (
    <section className="glass-panel hot-search-panel">
      <div className="panel-heading">
        <h2>热搜</h2>
        <Flame className="h-4 w-4" />
      </div>
      <div className="hot-list">
        {items.map((item, index) => (
          <a
            key={`${item.source}-${index}`}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="hot-item"
          >
            <span className="hot-rank">{index + 1}</span>
            <div className="hot-content">
              <span className="hot-title">{item.title}</span>
              <div className="hot-meta">
                <span className={`hot-source ${item.source}`}>
                  {item.source === 'bilibili' ? 'B站' : '微博'}
                </span>
                {item.heat > 0 && (
                  <span className="hot-heat">
                    {item.heat >= 10000 ? `${(item.heat / 10000).toFixed(1)}万` : item.heat}
                  </span>
                )}
              </div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 hot-link" />
          </a>
        ))}
      </div>
    </section>
  );
}
