import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ExternalLink, Search, Flame, X } from 'lucide-react';
import type { Story, HotSearchItem } from '../services/api';
import { ApiError, publicApi } from '../services/api';
import { eventPath, followInApp } from '../lib/readingNavigation';
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
  onResolveAliases: (stories: { id: string; legacyIds?: string[] }[]) => void;
  navigate: (path: string) => void;
  // Hot search props
  showHotPanel: boolean;
  hotItems: HotSearchItem[];
  hotLoading: boolean;
  selectedHotTag: HotTag;
}

export function FeedPanel(props: FeedPanelProps) {
  const displayStories = props.stories;

  // Debounce search input — local state for instant display, delayed filter update
  const [searchQuery, setSearchQuery] = useState(props.filters.q);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setSearchQuery(props.filters.q), [props.filters.q]);
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      props.setFilters(prev => ({ ...prev, q: value }));
    }, 300);
  };
  useEffect(() => () => clearTimeout(searchTimerRef.current), []);

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

  if (props.showFavorites) return <FavoritesPanel {...props} />;
  // Normal feed mode
  return (
    <section className="feed-panel glass-panel">
      <div className="feed-toolbar">
        <div>
          <h2>全部动态</h2>
          <p>共 {props.pagination.total} 条聚合情报</p>
        </div>
        <div className="feed-controls">
          <label className="search-field">
            <Search className="h-4 w-4" />
            <input
              value={searchQuery}
              onChange={event => handleSearchChange(event.target.value)}
              placeholder="全文搜索标题、内容、作者、来源"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear"
                onClick={() => {
                  setSearchQuery('');
                  props.setFilters(prev => ({ ...prev, q: '' }));
                }}
                aria-label="清除搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
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
            暂无符合条件的动态。可调整筛选或稍后刷新。
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
          navigate={props.navigate}
        />
      ))}

      {props.pagination.totalPages > 1 && (
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

type FavoriteResult = { id: string; story?: Story; missing?: boolean };

function FavoritesPanel({ favorites, onToggleFavorite, onResolveAliases, navigate }: FeedPanelProps) {
  const [results, setResults] = useState<FavoriteResult[]>([]);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    async function loadFavorites() {
      const found: FavoriteResult[] = [];
      for (let i = 0; i < favorites.length && !abort.signal.aborted; i += 6) {
        const batch = await Promise.all(favorites.slice(i, i + 6).map(async id => {
          try {
            return { id, story: (await publicApi.getEvent(id, abort.signal)).data };
          } catch (error) {
            return { id, missing: error instanceof ApiError && error.status === 404 };
          }
        }));
        found.push(...batch);
      }
      if (abort.signal.aborted) return;
      setResults(found);
      setLoading(false);
      onResolveAliases(found.flatMap(entry =>
        entry.story && entry.story.id !== entry.id ? [{ id: entry.story.id, legacyIds: [entry.id] }] : []));
    }
    void loadFavorites();
    return () => abort.abort();
  }, [favorites, retry, onResolveAliases]);
  const active = results.filter(entry => favorites.includes(entry.id));
  return (
    <section className="feed-panel glass-panel">
      <header className="feed-toolbar"><div><h2>我的收藏</h2><p>共 {favorites.length} 条 · 保存在当前浏览器</p></div></header>
      {!favorites.length && <p className="empty-state">暂无收藏。点击事件上的书签即可收藏。</p>}
      {favorites.length > 0 && loading && <p className="empty-state" role="status">正在查找收藏…</p>}
      {!loading && active.map((entry, index) => entry.story ? (
        <StoryCard key={entry.id} story={entry.story} index={index} isFavorite
          onToggleFavorite={() => onToggleFavorite(entry.id)} navigate={navigate} />
      ) : (
        <div className="reading-notice reading-favorite-notice" key={entry.id}>
          <div>{entry.missing
            ? entry.id.startsWith('story_') ? '一条旧收藏未找到可靠对应，已保留在浏览器。' : '收藏的事件暂不可见，未移除收藏。'
            : '暂时无法读取一条收藏，未移除收藏。'}</div>
          {entry.missing ? <a className="reading-link" href={eventPath(entry.id)} onClick={e => followInApp(e, navigate)}>查看状态</a>
            : <button type="button" className="reading-link" onClick={() => setRetry(n => n + 1)}>重试</button>}
          <button type="button" className="reading-link" onClick={() => onToggleFavorite(entry.id)}>移除收藏</button>
        </div>
      ))}
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
