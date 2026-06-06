import { ChevronDown, Search } from 'lucide-react';
import type { Story } from '../services/api';
import { StoryCard } from './StoryCard';

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
}

export function FeedPanel(props: FeedPanelProps) {
  const displayStories = props.showFavorites
    ? props.stories.filter(s => props.favorites.includes(s.id))
    : props.stories;

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
              value={props.filters.q}
              onChange={event => props.setFilters(prev => ({ ...prev, q: event.target.value }))}
              placeholder="搜索版本、角色、活动、来源"
            />
          </label>
        </div>
      </div>

      {displayStories.length === 0 && (
        <div className="empty-state">
          {props.showFavorites
            ? '暂无收藏。点击资讯卡片上的书签图标即可收藏。'
            : '暂无情报。进入后台添加默认源并手动同步一次即可开始。'}
        </div>
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
