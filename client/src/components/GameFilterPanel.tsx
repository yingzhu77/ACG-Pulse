import { useState, useMemo } from 'react';
import { Bot, ChevronDown, Flame, Gamepad2, Music, Radio } from 'lucide-react';
import type { Source, StoryFacets } from '../services/api';
import { cn } from '../lib/utils';
import { FOLLOW_CATEGORIES, GAME_CATEGORIES, gameAccents, gameIconUrls } from '../constants';
import { hasFilterValue, toggleFilterValue } from '../utils/filter';
import { importanceLabel } from '../utils/format';
import { GameGlyph } from './GameGlyph';
import type { HotTag } from '../hooks/useHotSearch';

export interface GameFilterPanelProps {
  games: string[];
  facets: StoryFacets;
  allFacets: StoryFacets;
  sourceFilter: string[];
  setSourceFilter: (v: string[]) => void;
  categoryGroup: 'game' | 'follow' | '';
  setCategoryGroup: (v: 'game' | 'follow' | '') => void;
  category: string;
  setCategory: (v: string) => void;
  filters: { importance: string; q: string };
  setFilters: React.Dispatch<React.SetStateAction<{ importance: string; q: string }>>;
  sources: Source[];
  showHotPanel: boolean;
  onToggleHotPanel: () => void;
  selectedHotTag: HotTag;
  onSelectHotTag: (tag: HotTag) => void;
}

export function GameFilterPanel(props: GameFilterPanelProps) {
  const [gamesOpen, setGamesOpen] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);
  const followedSources = useMemo(() => props.sources.filter(s => s.followed), [props.sources]);

  return (
    <div className="left-sidebar">
      {/* 1. 来源 - 游戏资讯 */}
      <div className="filter-block">
        <div className="filter-title-row">
          <p className="filter-label">
            <Gamepad2 className="h-3.5 w-3.5" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
            游戏资讯
          </p>
          <button className="mini-toggle" onClick={() => setGamesOpen(o => !o)} aria-expanded={gamesOpen}>
            {gamesOpen ? '收起' : '展开'}
            <ChevronDown className={cn('h-3.5 w-3.5', gamesOpen && 'rotate-180')} />
          </button>
        </div>
        {gamesOpen && (
          <div className="category-sub-list">
            {props.games.map((game, index) => (
              <button
                key={game}
                className={cn('game-row', hasFilterValue(props.sourceFilter, game) && 'selected')}
                onClick={() => {
                  const newFilter = hasFilterValue(props.sourceFilter, game)
                    ? props.sourceFilter.filter(s => s !== game)
                    : [...props.sourceFilter.filter(s => !/^\d+$/.test(s)), game];
                  props.setSourceFilter(newFilter);
                  setFollowOpen(false);
                }}
              >
                <GameGlyph label={game.slice(0, 1)} accent={gameAccents[index % gameAccents.length]} iconUrl={gameIconUrls[game]} />
                <span>{game}</span>
                <b>{props.allFacets.byGame?.[game] || 0}</b>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 来源 - 关注 */}
      <div className="filter-block">
        <div className="filter-title-row">
          <p className="filter-label">
            <Radio className="h-3.5 w-3.5" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
            关注
          </p>
          <button className="mini-toggle" onClick={() => setFollowOpen(o => !o)} aria-expanded={followOpen}>
            {followOpen ? '收起' : '展开'}
            <ChevronDown className={cn('h-3.5 w-3.5', followOpen && 'rotate-180')} />
          </button>
        </div>
        {followOpen && (
          <div className="category-sub-list">
            {followedSources.length > 0 ? (
              followedSources.map(source => (
                <button
                  key={source.id}
                  className={cn('follow-avatar-btn', hasFilterValue(props.sourceFilter, source.uid || '') && 'active')}
                  onClick={() => {
                    const uid = source.uid || '';
                    const newFilter = hasFilterValue(props.sourceFilter, uid)
                      ? props.sourceFilter.filter(s => s !== uid)
                      : [...props.sourceFilter.filter(s => /^\d+$/.test(s)), uid];
                    props.setSourceFilter(newFilter);
                    setGamesOpen(false);
                  }}
                >
                  <img
                    src={source.avatar || `https://pics.bilibili.com/crop/50_50_80/webp/${source.uid}.jpg`}
                    alt={source.name}
                    onError={e => {
                      const img = e.target as HTMLImageElement;
                      img.style.display = 'none';
                      const fallback = img.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                    referrerPolicy="no-referrer"
                  />
                  <span className="avatar-fallback" style={{ display: 'none', width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}>
                    {source.name.slice(0, 1)}
                  </span>
                  <span>{source.name}</span>
                </button>
              ))
            ) : (
              <span className="empty-hint" style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', padding: '4px 8px' }}>
                暂无关注源
              </span>
            )}
          </div>
        )}
      </div>

      {/* 2. AI 分类 */}
      <div className="filter-block">
        <p className="filter-label">AI 分类</p>
        <div className="group-tabs">
          <button
            className={cn('group-tab', props.categoryGroup === 'game' && 'active')}
            onClick={() => {
              if (props.categoryGroup === 'game') { props.setCategoryGroup(''); props.setCategory(''); }
              else { props.setCategoryGroup('game'); props.setCategory(''); }
            }}
          >游戏情报</button>
          <button
            className={cn('group-tab', props.categoryGroup === 'follow' && 'active')}
            onClick={() => {
              if (props.categoryGroup === 'follow') { props.setCategoryGroup(''); props.setCategory(''); }
              else { props.setCategoryGroup('follow'); props.setCategory(''); }
            }}
          >关注投稿</button>
        </div>
        {props.categoryGroup === 'game' && (
          <div className="category-sub-list">
            {Object.entries(GAME_CATEGORIES).map(([key, label]) => (
              <button
                key={key}
                className={cn('category-row', props.category === key && 'active')}
                onClick={() => props.setCategory(props.category === key ? '' : key)}
              >
                <Bot className="h-4 w-4" />
                <span>{label}</span>
                <b>{props.allFacets.byCategory?.[key] || 0}</b>
              </button>
            ))}
          </div>
        )}
        {props.categoryGroup === 'follow' && (
          <div className="category-sub-list">
            {Object.entries(FOLLOW_CATEGORIES).map(([key, label]) => (
              <button
                key={key}
                className={cn('category-row', props.category === key && 'active')}
                onClick={() => props.setCategory(props.category === key ? '' : key)}
              >
                <Music className="h-4 w-4" />
                <span>{label}</span>
                <b>{props.allFacets.byFollowCategory?.[key] || 0}</b>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 3. 重要性 */}
      <div className="filter-block">
        <p className="filter-label">重要性</p>
        {(['high', 'medium', 'low'] as const).map(value => (
          <button
            key={value}
            className={cn('importance-row', hasFilterValue(props.filters.importance, value) && 'active')}
            onClick={() => props.setFilters(prev => ({ ...prev, importance: toggleFilterValue(prev.importance, value, false) }))}
          >
            <span className={`importance-dot ${value}`} />
            <span>{importanceLabel(value)}</span>
            <b>{props.allFacets.byImportance?.[value] || 0}</b>
          </button>
        ))}
      </div>

      {/* 4. 热搜 */}
      <div className="filter-block">
        <button
          className={cn('category-row', props.showHotPanel && 'active')}
          onClick={props.onToggleHotPanel}
          style={{ width: '100%' }}
        >
          <Flame className="h-4 w-4" />
          <span>热搜</span>
          <ChevronDown className={cn('h-3.5 w-3.5 ml-auto transition-transform', props.showHotPanel && 'rotate-180')} />
        </button>
        {props.showHotPanel && (
          <div className="hot-tags">
            {(['game', 'anime', 'ai', 'movie'] as const).map(tag => (
              <button
                key={tag}
                className={cn('hot-tag', props.selectedHotTag === tag && 'active')}
                onClick={() => props.onSelectHotTag(tag)}
              >
                {tag === 'game' ? '🎮 游戏' : tag === 'anime' ? '📺 动漫' : tag === 'ai' ? '🤖 AI' : '🎬 影视'}
              </button>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
