import { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, ExternalLink, Search, Flame } from 'lucide-react';
import type { Story, HotSearchItem } from '../services/api';
import type { HotTag } from '../hooks/useHotSearch';
import { StoryCard } from './StoryCard';
import { cn } from '../lib/utils';

const TAG_LABELS: Record<HotTag, string> = {
  all: '热搜',
  game: '热搜游戏',
  anime: '热搜动漫',
  ai: '热搜AI',
  movie: '热搜影视'
};

export interface FeedPanelProps {
  stories: Story[];
  loading: boolean;
  filters: { importance: string; q: string };
  setFilters: React.Dispatch<React.SetStateAction<{ importance: string; q: string }>>;
  onRefresh: () => void;
  pagination: { page: number; limit: number; total: number; totalPages: number };
  page: number;
  setPage: (page: number) => void;
  favorites: string[];
  showFavorites: boolean;
  onToggleFavorite: (id: string) => void;
  // Hot search props
  showHotPanel: boolean;
  hotItems: HotSearchItem[];
  hotLoading: boolean;
  selectedHotTag: HotTag;
}

export function FeedPanel(props: FeedPanelProps) {
  // Hot search mode
  if (props.showHotPanel) {
    return (
      <section className="feed-panel glass-panel">
        <div className="feed-toolbar">
          <div>
            <h2>{TAG_LABELS[props.selectedHotTag]}</h2>
            <p>共 {props.hotItems.length} 条数据</p>
          </div>
        </div>

        {props.hotLoading && (
          <div className="empty-state">加载中...</div>
        )}

        {!props.hotLoading && props.hotItems.length === 0 && (
          <div className="empty-state">暂无热搜内容</div>
        )}

        {!props.hotLoading && props.hotItems.map((item, index) => (
          <HotSearchCard key={`${item.source}-${index}`} item={item} rank={index + 1} />
        ))}
      </section>
    );
  }

  // Normal feed mode
  const favoriteSet = useMemo(() => new Set(props.favorites), [props.favorites]);
  const displayStories = useMemo(
    () => props.showFavorites ? props.stories.filter(s => favoriteSet.has(s.id)) : props.stories,
    [props.stories, props.showFavorites, favoriteSet]
  );

  // Debounce search input — local state for instant display, delayed filter update
  const [searchQuery, setSearchQuery] = useState(props.filters.q);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => setSearchQuery(props.filters.q), [props.filters.q]);
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      props.setFilters(prev => ({ ...prev, q: value }));
    }, 300);
  };
  useEffect(() => () => clearTimeout(searchTimerRef.current), []);

  return (
    <section className="feed-panel glass-panel">
      <div className="feed-toolbar">
        <div>
          <h2>{props.showFavorites ? '我的收藏' : '情报流'}</h2>
          <p>共 {displayStories.length} 条{props.showFavorites ? '收藏' : '聚合情报'}</p>
        </div>
        <div className="feed-controls">
          <label className="search-field">
            <Search className="h-4 w-4" />
            <input
              value={searchQuery}
              onChange={event => handleSearchChange(event.target.value)}
              placeholder="搜索版本、角色、活动、来源"
            />
          </label>
        </div>
      </div>

      {displayStories.length === 0 && (
        props.loading ? (
          <div className="skeleton-list">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="skeleton-card">
                <div className="skeleton-cover" />
                <div className="skeleton-body">
                  <div className="skeleton-tags">
                    <div className="skeleton-tag" />
                    <div className="skeleton-tag" />
                  </div>
                  <div className="skeleton-line long" />
                  <div className="skeleton-line medium" />
                  <div className="skeleton-line short" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            {props.showFavorites
              ? '暂无收藏。点击资讯卡片上的书签图标即可收藏。'
              : '暂无情报。进入后台添加默认源并手动同步一次即可开始。'}
          </div>
        )
      )}
      {displayStories.map((story, index) => (
        <StoryCard
          key={story.id}
          story={story}
          index={index}
          isFavorite={props.favorites.includes(story.id)}
          onToggleFavorite={props.onToggleFavorite}
        />
      ))}

      {props.pagination.totalPages > 1 && !props.showFavorites && (
        <div className="pagination-bar">
          <button
            className="icon-button"
            disabled={props.page <= 1}
            onClick={() => props.setPage(props.page - 1)}
            aria-label="上一页"
          >
            <ChevronDown className="h-4 w-4 rotate-90" />
          </button>
          <span className="page-info">
            第 {props.page} / {props.pagination.totalPages} 页
          </span>
          <button
            className="icon-button"
            disabled={props.page >= props.pagination.totalPages}
            onClick={() => props.setPage(props.page + 1)}
            aria-label="下一页"
          >
            <ChevronDown className="h-4 w-4 -rotate-90" />
          </button>
        </div>
      )}
    </section>
  );
}

// Hot search card component
function HotSearchCard({ item, rank }: { item: HotSearchItem; rank: number }) {
  return (
    <article className="story-card hot-card">
      <div className="story-cover hot-rank-cover">
        <span className={cn('hot-rank-number', rank <= 3 && 'top-3')}>{rank}</span>
      </div>

      <div className="story-body">
        <div className="story-meta-line">
          <span className={`hot-source-badge ${item.source}`}>
            {item.source === 'bilibili' ? 'B站' : '微博'}
          </span>
          {item.heat > 0 && (
            <span className="hot-heat-badge">
              <Flame className="h-3 w-3" />
              {item.heat >= 10000 ? `${(item.heat / 10000).toFixed(1)}万` : item.heat}
            </span>
          )}
          {item.tags.map(tag => (
            <span key={tag} className="hot-tag-badge">
              {tag === 'game' ? '游戏' : tag === 'anime' ? '动漫' : tag === 'ai' ? 'AI' : tag === 'movie' ? '影视' : tag}
            </span>
          ))}
        </div>

        <a href={item.url} target="_blank" rel="noreferrer" className="story-title">
          {item.title}
        </a>
      </div>

      <div className="story-actions">
        <a
          className="source-jump-button"
          href={item.url}
          target="_blank"
          rel="noreferrer"
          aria-label="查看原文"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </article>
  );
}
