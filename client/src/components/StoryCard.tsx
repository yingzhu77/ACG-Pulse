import { useState } from 'react';
import { Bookmark, Clock3, ExternalLink, Zap } from 'lucide-react';
import type { Story } from '../services/api';
import { cn } from '../lib/utils';
import { sourceNames } from '../constants';
import { categoriesLabel, importanceLabel, formatDateTime } from '../utils/format';
import { SourceIcon } from './SourceIcon';
import { SourceGlyph } from './SourceGlyph';
import { Tag } from './Tag';

interface StoryCardProps {
  story: Story;
  index: number;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
}

export function StoryCard({ story, index, isFavorite, onToggleFavorite }: StoryCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const primary = story.items[0];
  const coverUrl = story.coverUrl || primary?.coverUrl;
  const source = story.sources[0];
  const sourceType = source?.sourceType || primary?.sourceType || 'rss';
  const publishedAt = story.publishedAt || primary?.publishedAt || null;
  const fetchedAt = story.fetchedAt || primary?.fetchedAt || primary?.createdAt || null;

  return (
    <article className={cn('story-card', `importance-${story.importance}`)} style={{ '--item-index': index } as React.CSSProperties}>
      <div className="story-cover">
        {coverUrl && !imageFailed ? (
          <img
            src={coverUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <SourceGlyph type={sourceType} />
        )}
      </div>

      <div className="story-body">
        <div className="story-meta-line">
          <span className="source-pill">
            <SourceIcon type={sourceType} />
            {source?.sourceName || sourceNames[sourceType] || sourceType}
            {story.sourceCount > 1 ? ` +${story.sourceCount - 1}` : ''}
          </span>
          {story.game && <Tag>{story.game}</Tag>}
          <Tag>{categoriesLabel(story.category || 'other')}</Tag>
          <Tag tone={story.importance}>{importanceLabel(story.importance)}</Tag>
        </div>

        <a href={source?.url || primary?.url} target="_blank" rel="noreferrer" className="story-title">
          {story.canonicalTitle}
        </a>
        <p className="story-summary">{story.summary || primary?.content || '暂无摘要'}</p>

        <div className="story-footer">
          <span>
            <Clock3 className="h-3.5 w-3.5" />
            发布 {formatDateTime(publishedAt)}
          </span>
          <span>
            <Zap className="h-3.5 w-3.5" />
            抓取 {formatDateTime(fetchedAt)}
          </span>
          <span>{story.itemCount > 1 ? `已合并 ${story.itemCount} 条来源记录` : '单来源情报'}</span>
        </div>
      </div>

      <div className="story-actions">
        {story.sources.slice(0, 3).map((itemSource) => (
          <a
            key={`${itemSource.sourceId}:${itemSource.url}`}
            className="source-jump-button"
            href={itemSource.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`打开${itemSource.sourceName}`}
            title={`${itemSource.sourceName}：${itemSource.title}`}
          >
            <SourceIcon type={itemSource.sourceType} />
          </a>
        ))}
        {story.sources.length === 0 && (
          <a className="source-jump-button" href={source?.url || primary?.url} target="_blank" rel="noreferrer" aria-label="打开来源">
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
        <button
          className={cn('icon-button', isFavorite && 'favorited')}
          aria-label={isFavorite ? '取消收藏' : '收藏'}
          onClick={() => onToggleFavorite?.(story.id)}
        >
          <Bookmark className={cn('h-4 w-4', isFavorite && 'fill-current')} />
        </button>
      </div>
    </article>
  );
}
