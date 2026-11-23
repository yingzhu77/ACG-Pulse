import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Bookmark, CircleAlert, Download, Inbox, Rss } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError, publicApi } from '../services/api';
import type { EditionEntry, EditionIndex, EditionResponse, FeedItem } from '../services/api';
import { editionPath, eventPath, eventReturnLabel, followInApp, originalUrl } from '../lib/readingNavigation';
import { distinctImpact } from '../lib/readingCopy';
import { eventReadState, isReadStateKey } from '../lib/eventReadState';
import { usePageTitle } from '../hooks/useReadingHistory';

type Navigate = (path: string) => void;
type Bookmarks = { isFavorite: (id: string) => boolean; toggleFavorite: (id: string) => void };
const shanghaiTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const editionDay = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' });
const editionWeekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long' });
function displayTime(value?: string | null): string {
  if (!value) return '未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : shanghaiTime.format(date);
}
function shanghaiDay(offset: number) {
  return new Date(Date.now() + (8 + offset * 24) * 3_600_000).toISOString().slice(0, 10);
}

function useReadingRequest<T>(load: (signal: AbortSignal) => Promise<T>, refresh: number) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState(previous => ({ data: previous.data, loading: true }));
    load(controller.signal).then(
      data => { if (!controller.signal.aborted) setState({ data, loading: false }); },
      error => {
        if (!controller.signal.aborted) setState(previous => ({
          data: error instanceof ApiError && error.status === 404 ? undefined : previous.data,
          error, loading: false
        }));
      }
    );
    return () => controller.abort();
  }, [load, refresh, retry]);
  return { ...state, retry: () => setRetry(n => n + 1) };
}

function ReadingLink({ to, navigate, children, className = 'reading-link' }: {
  to: string; navigate: Navigate; children: ReactNode; className?: string;
}) {
  return <a href={to} className={className} onClick={e => followInApp(e, navigate)}>{children}</a>;
}

function Original({ url, children }: { url: string | null | undefined; children: ReactNode }) {
  const original = originalUrl(url);
  return original
    ? <a className="reading-link" target="_blank" rel="noopener noreferrer" href={original}>{children}<ArrowUpRight aria-hidden="true" /></a>
    : null;
}

function RequestNotice({ children, retry }: { children: ReactNode; retry?: () => void }) {
  return <div className="reading-notice" role="status"><CircleAlert aria-hidden="true" /><div>{children}</div>
    {retry && <button type="button" className="reading-link" onClick={retry}>重试</button>}
  </div>;
}

const summaryLabels: Record<EditionEntry['editorial']['summaryStatus'], string> = {
  available: '暂无摘要，请查看原文。',
  insufficient: '来源材料不足，请查看原文。',
  failed: '分析未能完成，请查看原文。',
  pending: '分析处理中，请查看原文。',
  unavailable: '未启用模型分析，请查看原文。'
};

function EntryCard({ story, navigate, read, bookmarks }: { story: EditionEntry; navigate: Navigate; read?: boolean; bookmarks: Bookmarks }) {
  const { editorial } = story;
  const source = story.sources[0];
  const saved = bookmarks.isFavorite(story.id);
  const impact = editorial.summaryStatus === 'available' ? distinctImpact(editorial.impact, story.summary, story.canonicalTitle) : null;
  return (
    <article className="reading-entry">
      <div className="reading-kicker">
        {source && (originalUrl(source.url) ? <Original url={source.url}>{source.sourceName} · 原文</Original> : <span>{source.sourceName}</span>)}
        {editorial.kind === 'update' && <span className="reading-kind">新进展</span>}
        {editorial.late && <span className="reading-kind">迟到收录</span>}
        {editorial.correctedAt && <span className="reading-kind">已更正</span>}
        {read && <span className="reading-read">已读</span>}
        <span className="reading-entry-stamp">
          {editorial.kind === 'update' ? '进展发布' : '原文发布'}{' '}
          <time dateTime={editorial.publishedAt}>{displayTime(editorial.publishedAt)}</time>
        </span>
      </div>
      <h3><ReadingLink to={eventPath(story.id)} navigate={navigate} className="reading-title-link">{story.canonicalTitle}</ReadingLink></h3>
      <p className={editorial.summaryStatus === 'available' ? undefined : 'reading-summary-note'}>
        {editorial.summaryStatus === 'available' && story.summary ? story.summary : summaryLabels[editorial.summaryStatus]}
      </p>
      {impact && <p className="reading-impact"><b>为什么重要</b>{impact}</p>}
      <div className="reading-card-actions">
        <details className="reading-minor-details">
          <summary>收录详情</summary>
          <div className="reading-detail-chips">
            {story.game && <span>{story.game}</span>}
            <span>发现 {displayTime(editorial.discoveredAt)}</span>
            <span>{editorial.selectedAt ? `入选 ${displayTime(editorial.selectedAt)}` : '当前精选 · 尚未出刊'}</span>
            {editorial.correctedAt && <span>更正 {displayTime(editorial.correctedAt)}</span>}
          </div>
        </details>
        <button type="button" className="reading-card-bookmark" aria-pressed={saved}
          aria-label={`${saved ? '取消收藏' : '收藏'}：${story.canonicalTitle}`} onClick={() => bookmarks.toggleFavorite(story.id)}>
          <Bookmark aria-hidden="true" />{saved ? '已收藏' : '收藏'}
        </button>
      </div>
    </article>
  );
}

function EditionContent({ data, navigate, bookmarks, emptyAction, readIds, onlyUnread = false }: {
  data: EditionResponse; navigate: Navigate; bookmarks: Bookmarks; emptyAction: ReactNode; readIds?: Set<string>; onlyUnread?: boolean;
}) {
  const { health } = data;
  const noSources = data.status !== 'pending' && health.configuredSources === 0;
  const visibleStories = onlyUnread ? data.stories.filter(story => !readIds?.has(story.id)) : data.stories;
  const notes = [
    noSources ? '未配置可用的采集来源' : '',
    health.failedSources ? `${health.failedSources} 个来源采集失败` : '',
    health.uncheckedSources ? `${health.uncheckedSources} 个来源无本期采集记录` : '',
    health.degradedSources ? `${health.degradedSources} 个来源仅部分采集成功` : '',
    health.staleSources ? `${health.staleSources} 个来源更新延迟` : '',
    health.pendingAnalysis ? `${health.pendingAnalysis} 条待分析` : '',
    health.failedAnalysis ? `${health.failedAnalysis} 条分析失败` : '',
    health.unavailableAnalysis ? `${health.unavailableAnalysis} 条未启用模型分析` : ''
  ].filter(Boolean);
  const uncertain = notes.length > 0 || !health.configuredSources;
  const coverageLabel = noSources ? '暂无可用来源'
    : health.failedSources ? '来源采集失败'
    : health.staleSources ? '采集更新延迟'
    : health.degradedSources ? '部分采集未完成'
    : health.uncheckedSources ? '部分来源尚未采集'
    : '部分内容尚未处理';
  const emptyMessage = data.status === 'failed' ? '采集或处理未完成，本期无法出刊。'
    : data.status === 'pending' ? '这一期尚未出刊。'
    : data.withdrawnCount ? '本期可见内容已撤回。'
    : noSources ? '暂无可用来源，还不能判断是否有新动态。'
    : data.status === 'empty' && health.configuredSources === undefined && !notes.length ? '本期没有记录入选内容。'
    : uncertain ? '暂未发现可呈现的精选，采集覆盖或内容处理尚不完整。'
    : data.status === 'empty' ? '本期没有达到精选标准的新内容。'
    : '今天暂无值得精选的新内容。';
  return <>
    {(data.status === 'live' || notes.length > 0) && <div className="reading-health">
      {data.status === 'live' && <span>最近更新 {health.lastSuccessAt ? displayTime(health.lastSuccessAt) : '暂无记录'}</span>}
      {notes.length > 0 && <details className="reading-minor-details">
        <summary>{coverageLabel}</summary>
        <ul>{notes.map(note => <li key={note}>{note}</li>)}</ul>
        {health.lastCheckedAt && <p>最近检查 {displayTime(health.lastCheckedAt)}</p>}
        {health.configuredSources ? <p>已配置 {health.configuredSources} 个来源</p> : null}
      </details>}
    </div>}
    {data.withdrawnCount > 0 && <p className="reading-muted">本期有内容已撤回，以当前公开状态为准。</p>}
    {visibleStories.length === 0
      ? <div className="reading-empty-state" role="status"><Inbox aria-hidden="true" />
        <p>{data.stories.length ? '当前筛选下的精选已全部读完。' : emptyMessage}</p>{emptyAction}</div>
      : <div className="reading-entries">{visibleStories.map(entry =>
        <EntryCard key={entry.id} story={entry} navigate={navigate} read={readIds?.has(entry.id)} bookmarks={bookmarks} />)}</div>}
  </>;
}

export function FeaturedPanel({ games, game, onGameChange, refresh, navigate, onOpenFollowing, onOpenSettings, bookmarks }: {
  games: string[]; game: string; onGameChange: (game: string) => void; refresh: number; navigate: Navigate;
  onOpenFollowing: () => void; onOpenSettings: () => void; bookmarks: Bookmarks;
}) {
  return (
    <section className="reading-panel">
      <header className="reading-header">
        <div>
          <h1>今日精选</h1>
          <p>重要消息与实质进展 · 北京时间</p>
        </div>
      </header>
      <div className="reading-toolbar">
        {games.length > 0 && <div className="reading-filter-area">
          <label className="reading-filter"><span>作品</span>
            <select value={game} onChange={e => onGameChange(e.target.value)}>
              <option value="">全部作品</option>
              {games.map(item => <option key={item}>{item}</option>)}
            </select>
          </label>
          {game && <button type="button" className="reading-link reading-reset" onClick={() => onGameChange('')}>查看全部作品</button>}
        </div>}
        <button type="button" className="reading-link reading-follow" onClick={onOpenFollowing}><Rss aria-hidden="true" />关注投稿</button>
      </div>
      <FeaturedEntries key={game} game={game} refresh={refresh} navigate={navigate} bookmarks={bookmarks}
        onClearGame={() => onGameChange('')} onOpenSettings={onOpenSettings} />
    </section>
  );
}

function FeaturedEntries({ game, refresh, navigate, bookmarks, onClearGame, onOpenSettings }: {
  game: string; refresh: number; navigate: Navigate; bookmarks: Bookmarks; onClearGame: () => void; onOpenSettings: () => void;
}) {
  const load = useCallback((signal: AbortSignal) => publicApi.getFeatured(game, signal), [game]);
  const result = useReadingRequest(load, refresh);
  const [, refreshMarks] = useReducer(n => n + 1, 0);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (isReadStateKey(event.key)) refreshMarks(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const onlyUnread = eventReadState.onlyUnread();
  const setOnlyUnread = (enabled: boolean) => { eventReadState.setOnlyUnread(enabled); refreshMarks(); };
  // Historical editions have no readProgressIds and do not use this filter.
  const readIds = new Set(result.data?.stories.filter(story =>
    story.readProgressIds && eventReadState.hasRead(story.id, story.readProgressIds)
  ).map(story => story.id));
  const day = result.data && new Date(result.data.date + 'T00:00:00+08:00');
  function emptyAction(data: EditionResponse) {
    if (onlyUnread && data.stories.length) return <button type="button" className="reading-link" onClick={() => setOnlyUnread(false)}>显示已读精选</button>;
    if (game) return <button type="button" className="reading-link" onClick={onClearGame}>浏览其他作品</button>;
    if (data.health.configuredSources === 0) return <button type="button" className="reading-link" onClick={onOpenSettings}>打开来源设置</button>;
    return <ReadingLink to="/daily" navigate={navigate}>查看往期日报</ReadingLink>;
  }
  return <>
    {Boolean(result.error) && <RequestNotice retry={result.retry}>{result.data ? '刷新精选失败，显示上次加载的内容。' : '精选暂时无法加载。'}</RequestNotice>}
    {result.loading && !result.data && <p className="reading-empty" role="status">正在加载今日精选…</p>}
    {result.data && day && <>
      <div className="reading-list-head">
        <h2><time dateTime={result.data.date}>{editionDay.format(day)}</time></h2>
        <span>{editionWeekday.format(day)} · {result.data.stories.length} 条精选 · {result.data.stories.length - readIds.size} 条未读</span>
        <label className="reading-unread-toggle"><input type="checkbox" checked={onlyUnread}
          onChange={event => setOnlyUnread(event.target.checked)} />只看未读</label>
      </div>
      <EditionContent data={result.data} navigate={navigate} readIds={readIds} onlyUnread={onlyUnread}
        bookmarks={bookmarks} emptyAction={emptyAction(result.data)} />
    </>}
  </>;
}

function issueHeadline(issue: EditionIndex[number]) {
  if (issue.status === 'failed') return '采集或处理未完成，等待补刊';
  if (issue.status === 'empty') return '当日无重点';
  return issue.headline ?? (issue.visibleCount === 0 ? '本期内容已撤回' : '已出刊');
}

export function EditionsPanel({ date, refresh, navigate, bookmarks }: { date?: string; refresh: number; navigate: Navigate; bookmarks: Bookmarks }) {
  const [cursors, setCursors] = useState<string[]>([]);
  const before = cursors.at(-1);
  const loadIssues = useCallback(async (signal: AbortSignal) => ({
    ...await publicApi.getEditions(signal, before), before
  }), [before]);
  const index = useReadingRequest(loadIssues, refresh);
  const page = index.data?.before === before ? index.data : undefined;
  const nextBefore = page?.nextBefore;
  const selectedDate = date || page?.data[0]?.date || shanghaiDay(-1);
  usePageTitle(!date && !page && index.loading ? '日报' : `${selectedDate} 日报`);
  const pageTo = (next: string[]) => {
    // Browsing the directory keeps the open issue and its export links in place.
    if (!date) navigate(editionPath(selectedDate));
    setCursors(next);
  };
  const links = (page?.data ?? []).map(issue => (
    <a key={issue.date} className="reading-archive-issue" href={editionPath(issue.date)}
      aria-current={selectedDate === issue.date ? 'page' : undefined} onClick={event => followInApp(event, navigate)}>
      <time dateTime={issue.date}>{issue.date}</time>
      <span>{issueHeadline(issue)}</span>
      {typeof issue.visibleCount === 'number' && <small>{issue.visibleCount} 条可见事件</small>}
    </a>
  ));
  return (
    <section className="reading-panel">
      <header className="reading-header">
        <div>
          <h1>日报存档</h1>
          <p>按北京时间出刊，保留各期与原文出处。</p>
        </div>
        <label className="reading-filter">刊期
          <input type="date" value={selectedDate} max={shanghaiDay(0)} onChange={event => { if (event.target.value) navigate(editionPath(event.target.value)); }} />
        </label>
      </header>
      {Boolean(index.error) && <RequestNotice retry={index.retry}>暂时无法读取往期列表。仍可按日期查阅。</RequestNotice>}
      {index.loading && !page && <p className="reading-empty" role="status">正在加载刊期目录…</p>}
      {links.length > 0 && <nav className="reading-archive-list" aria-label="刊期目录">{links.slice(0, 3)}</nav>}
      {links.length > 3 && <details className="reading-archive-more" key={before ?? 'latest'}>
        <summary>更多往期日报</summary>
        <nav className="reading-archive-list" aria-label="更多往期日报">{links.slice(3)}</nav>
      </details>}
      {(before || nextBefore) && <nav className="reading-action-row" aria-label="刊期目录翻页">
        {before && <button className="reading-link" onClick={() => pageTo(cursors.slice(0, -1))}>较新刊期</button>}
        {nextBefore && <button className="reading-link" onClick={() => pageTo([...cursors, nextBefore])}>较早刊期</button>}
      </nav>}
      {(date || !index.loading || page) && <EditionIssue key={selectedDate} date={selectedDate} refresh={refresh} navigate={navigate}
        bookmarks={bookmarks} otherDate={page?.data.find(issue => issue.date !== selectedDate && issue.status === 'published' && issue.visibleCount > 0)?.date} />}
    </section>
  );
}

function EditionIssue({ date, refresh, navigate, bookmarks, otherDate }: {
  date: string; refresh: number; navigate: Navigate; bookmarks: Bookmarks; otherDate?: string;
}) {
  const load = useCallback((signal: AbortSignal) => publicApi.getEdition(date, signal), [date]);
  const result = useReadingRequest(load, refresh);
  const downloadable = result.data?.status === 'published' || result.data?.status === 'empty';
  return <>
    <div className="reading-list-head">
      <div className="reading-issue-date"><h2><time dateTime={date}>{date}</time></h2>
        {result.data?.publishedAt && <span>出刊 {displayTime(result.data.publishedAt)}</span>}
      </div>
      {downloadable && <div className="reading-action-row">
        <a className="reading-link" href={publicApi.exportReportUrl({ type: 'daily', date })}><Download aria-hidden="true" />Markdown</a>
        <a className="reading-link" href={`/api/public/reports/daily?date=${encodeURIComponent(date)}`} download={`acg-pulse-${date}.json`}><Download aria-hidden="true" />JSON</a>
      </div>}
    </div>
    {Boolean(result.error) && <RequestNotice retry={result.retry}>{result.data ? '刷新刊期失败，显示上次加载的内容。' : '暂时无法读取这一期。'}</RequestNotice>}
    {result.loading && !result.data && <p className="reading-empty" role="status">正在加载日报…</p>}
    {result.data && <EditionContent data={result.data} navigate={navigate} bookmarks={bookmarks}
      emptyAction={otherDate ? <ReadingLink to={editionPath(otherDate)} navigate={navigate}>阅读 {otherDate} 日报</ReadingLink>
        : <ReadingLink to="/" navigate={navigate}>去今日精选</ReadingLink>} />}
  </>;
}

function FeedItemLink({ item }: { item: FeedItem }) {
  const url = originalUrl(item.url);
  return <li>
    <div>{url ? <Original url={url}>{item.title}</Original> : item.title}</div>
    <p>{item.source.name} · 原文发布 {displayTime(item.publishedAt)}</p>
  </li>;
}

export function EventPanel({ id, back, refresh, navigate, favorites, onToggleFavorite, onResolveAliases }: {
  id: string; back?: string; refresh: number; navigate: Navigate; favorites: string[];
  onToggleFavorite: (id: string) => void; onResolveAliases: (stories: {id: string; legacyIds?: string[]}[]) => void;
}) {
  const load = useCallback((signal: AbortSignal) => publicApi.getEvent(id, signal).then(r => r.data), [id]);
  const result = useReadingRequest(load, refresh);
  const event = result.data;
  const markedEvent = useRef<string | null>(null);
  useEffect(() => {
    if (!event || result.loading || result.error || markedEvent.current === event.id) return;
    const markWhenVisible = () => {
      if (document.visibilityState !== 'visible' || markedEvent.current === event.id) return;
      eventReadState.markRead(event.id, event.progress.map(item => item.id));
      markedEvent.current = event.id;
    };
    markWhenVisible();
    document.addEventListener('visibilitychange', markWhenVisible);
    return () => document.removeEventListener('visibilitychange', markWhenVisible);
  }, [event, result.loading, result.error]);
  useEffect(() => {
    if (event && id !== event.id) onResolveAliases([{ id: event.id, legacyIds: [id] }]);
  }, [event, id, onResolveAliases]);
  const missing = result.error instanceof ApiError && result.error.status === 404;
  // Do not show stale event content if a refresh confirms withdrawal or deletion.
  const visible = event && !missing;
  usePageTitle(missing ? '事件暂不可见' : visible && !result.loading ? event.canonicalTitle : '事件详情');
  const firstReport = event?.firstPublishedAt ? event.sources.find(source => source.publishedAt === event.firstPublishedAt) : undefined;
  const primary = firstReport ?? event?.sources[0];
  return (
    <section className="reading-panel reading-event">
      <nav className="reading-back" aria-label="返回列表">
        <ReadingLink to={back || '/all'} navigate={navigate}><ArrowLeft aria-hidden="true" />{eventReturnLabel(back)}</ReadingLink>
      </nav>
      {result.loading && !event && <p className="reading-empty" role="status">正在加载事件…</p>}
      {Boolean(result.error) && <RequestNotice retry={missing ? undefined : result.retry}>
        {missing ? id.startsWith('story_') ? '这条旧事件未找到可靠对应，可返回全部动态搜索。' : '该事件已撤回或暂不可见。'
          : event ? '刷新事件失败，显示上次加载的内容。' : '暂时无法读取该事件。'}
      </RequestNotice>}
      {visible && <>
        <header className="reading-header reading-event-header">
          <div>
            <p className="reading-eyebrow">{event.game || '事件详情'}</p>
            <h1>{event.canonicalTitle}</h1>
            <p>{event.summary || '暂无可靠摘要，详情以原文为准。'}</p>
          </div>
          <button type="button" className="reading-link" onClick={() => onToggleFavorite(event.id)} aria-pressed={favorites.includes(event.id)}>
            <Bookmark aria-hidden="true" />{favorites.includes(event.id) ? '已收藏' : '收藏事件'}
          </button>
        </header>
        {event.progress.length > 0 ? <section className="reading-detail-section">
          <h2>首报</h2>
          <div className="reading-first-report">
            <time dateTime={event.firstPublishedAt ?? undefined}>首报时间 {displayTime(event.firstPublishedAt)}</time>
            {firstReport && (originalUrl(firstReport.url)
              ? <Original url={firstReport.url}>{firstReport.title}</Original> : <span>{firstReport.title}</span>)}
          </div>
          <h2>实质进展</h2>
          <ul className="reading-source-list">{event.progress.map(item => <FeedItemLink item={item} key={item.id} />)}</ul>
        </section> : <div className="reading-entry-foot reading-event-primary">
          <time dateTime={event.firstPublishedAt ?? undefined}>首报时间 {displayTime(event.firstPublishedAt)}</time>
          {primary && (originalUrl(primary.url) ? <Original url={primary.url}>{primary.sourceName} · 原文</Original> : <span>{primary.sourceName}</span>)}
        </div>}
        <details className="reading-minor-details reading-event-reports">
          <summary>相关报道与原文（{event.sources.length}）</summary>
          <dl className="reading-event-times">
            <div><dt>首次发现</dt><dd>{displayTime(event.firstDiscoveredAt)}</dd></div>
          </dl>
          <ul className="reading-source-list">
            {event.sources.map(source => <li key={source.itemId}>
              <p>{source.sourceName} · 原文发布 {displayTime(source.publishedAt)}</p>
              {originalUrl(source.url) ? <Original url={source.url}>{source.title}</Original> : <span>{source.title}</span>}
            </li>)}
          </ul>
        </details>
      </>}
    </section>
  );
}
