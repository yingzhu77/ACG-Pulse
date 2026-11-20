import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Bookmark, CalendarDays, CircleAlert, Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError, publicApi } from '../services/api';
import type { EditionEntry, EditionIndex, EditionResponse, FeedItem } from '../services/api';
import { editionPath, eventPath, followInApp, originalUrl } from '../lib/readingNavigation';
import { cn } from '../lib/utils';
import { distinctImpact } from '../lib/readingCopy';

type Navigate = (path: string) => void;
const shanghaiTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
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
      error => { if (!controller.signal.aborted) setState(previous => ({ data: previous.data, error, loading: false })); }
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

function EntryCard({ story, navigate }: { story: EditionEntry; navigate: Navigate }) {
  const { editorial } = story;
  const source = story.sources[0];
  const impact = editorial.summaryStatus === 'available' ? distinctImpact(editorial.impact, story.summary, story.canonicalTitle) : null;
  const hasBadge = editorial.kind === 'update' || editorial.late || editorial.correctedAt;
  return (
    <article className="reading-entry">
      <div className="reading-entry-body">
        {hasBadge && <div className="reading-kicker">
          {editorial.kind === 'update' && <span className="reading-kind">新进展</span>}
          {editorial.late && <span className="reading-kind">迟到收录</span>}
          {editorial.correctedAt && <span className="reading-kind">已更正</span>}
        </div>}
        <h3><ReadingLink to={eventPath(story.id)} navigate={navigate} className="reading-title-link">{story.canonicalTitle}</ReadingLink></h3>
        <p className={editorial.summaryStatus === 'available' ? undefined : 'reading-summary-note'}>
          {editorial.summaryStatus === 'available' && story.summary ? story.summary : summaryLabels[editorial.summaryStatus]}
        </p>
        {impact && <p className="reading-impact"><b>为什么重要</b>{impact}</p>}
        <div className="reading-entry-foot">
          {source && (originalUrl(source.url) ? <Original url={source.url}>{source.sourceName} · 原文</Original> : <span>{source.sourceName}</span>)}
          <time dateTime={editorial.publishedAt}>{editorial.kind === 'update' ? '进展发布' : '原文发布'} {displayTime(editorial.publishedAt)}</time>
        </div>
        <details className="reading-minor-details">
          <summary>收录详情</summary>
          <div className="reading-detail-chips">
            {story.game && <span>{story.game}</span>}
            <span>发现 {displayTime(editorial.discoveredAt)}</span>
            <span>{editorial.selectedAt ? `入选 ${displayTime(editorial.selectedAt)}` : '当前精选 · 尚未出刊'}</span>
            {editorial.correctedAt && <span>更正 {displayTime(editorial.correctedAt)}</span>}
          </div>
        </details>
      </div>
    </article>
  );
}

function EditionContent({ data, navigate }: { data: EditionResponse; navigate: Navigate }) {
  const { health } = data;
  const noSources = health.configuredSources === 0;
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
    {data.stories.length === 0
      ? <p className="reading-empty" role="status">{emptyMessage}</p>
      : <div className="reading-entries">{data.stories.map(entry => <EntryCard key={entry.id} story={entry} navigate={navigate} />)}</div>}
  </>;
}

export function FeaturedPanel({ games, game, onGameChange, refresh, navigate, onOpenFollowing, onOpenAll }: {
  games: string[]; game: string; onGameChange: (game: string) => void; refresh: number; navigate: Navigate; onOpenFollowing: () => void; onOpenAll: () => void;
}) {
  return (
    <section className="reading-panel glass-panel">
      <header className="reading-header">
        <div>
          <h1>今日精选</h1>
          <p>重要消息与实质进展 · 北京时间</p>
        </div>
        {games.length > 0 && <div className="reading-filter-area">
          <label className="reading-filter"><span className="sr-only">作品</span>
            <select value={game} onChange={e => onGameChange(e.target.value)}>
              <option value="">全部作品</option>
              {games.map(item => <option key={item}>{item}</option>)}
            </select>
          </label>
          {game && <button type="button" className="reading-link reading-reset" onClick={() => onGameChange('')}>查看全部作品</button>}
        </div>}
      </header>
      <nav className="reading-quick-nav" aria-label="更多内容">
        <ReadingLink to="/all" navigate={onOpenAll}>全部动态</ReadingLink>
        <button type="button" className="reading-link" onClick={onOpenFollowing}>关注投稿</button>
        <ReadingLink to="/community" navigate={navigate}>社区热点</ReadingLink>
        <ReadingLink to="/daily" navigate={navigate}><CalendarDays aria-hidden="true" />日报存档</ReadingLink>
      </nav>
      <FeaturedEntries key={game} game={game} refresh={refresh} navigate={navigate} />
    </section>
  );
}

function FeaturedEntries({ game, refresh, navigate }: { game: string; refresh: number; navigate: Navigate }) {
  const load = useCallback((signal: AbortSignal) => publicApi.getFeatured(game, signal), [game]);
  const result = useReadingRequest(load, refresh);
  return <>
    {Boolean(result.error) && <RequestNotice retry={result.retry}>{result.data ? '刷新精选失败，显示上次加载的内容。' : '精选暂时无法加载。'}</RequestNotice>}
    {result.loading && !result.data && <p className="reading-empty" role="status">正在加载今日精选…</p>}
    {result.data && <>
      <div className="reading-list-head"><time dateTime={result.data.date}>{result.data.date}</time></div>
      <EditionContent data={result.data} navigate={navigate} />
    </>}
  </>;
}

const issueLabels: Record<EditionIndex[number]['status'], string> = { published: '已出刊', empty: '无重点', failed: '待补刊' };
const loadIssues = (signal: AbortSignal) => publicApi.getEditions(signal);

export function EditionsPanel({ date, refresh, navigate }: { date?: string; refresh: number; navigate: Navigate }) {
  const index = useReadingRequest(loadIssues, refresh);
  const selectedDate = date || index.data?.data[0]?.date || shanghaiDay(-1);
  return (
    <section className="reading-panel glass-panel">
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
      {index.data?.data.length ? (
        <nav className="reading-quick-nav" aria-label="最近日报">
          {index.data.data.slice(0, 7).map(issue => (
            <ReadingLink key={issue.date} to={editionPath(issue.date)} navigate={navigate}
              className={cn('reading-link', selectedDate === issue.date && 'reading-current')}>
              {issue.date.slice(5)} <small>{issueLabels[issue.status]}</small>
            </ReadingLink>
          ))}
        </nav>
      ) : null}
      {index.data && index.data.data.length > 7 && <details className="reading-archive-more">
        <summary>更多往期日报</summary>
        <nav className="reading-quick-nav" aria-label="更多往期日报">
          {index.data.data.slice(7).map(issue => <ReadingLink key={issue.date} to={editionPath(issue.date)} navigate={navigate}
            className={cn('reading-link', selectedDate === issue.date && 'reading-current')}>
            {issue.date} <small>{issueLabels[issue.status]}</small>
          </ReadingLink>)}
        </nav>
      </details>}
      {!date && index.loading && !index.data
        ? <p className="reading-empty" role="status">正在查找最近一期…</p>
        : <EditionIssue key={selectedDate} date={selectedDate} refresh={refresh} navigate={navigate} />}
    </section>
  );
}

function EditionIssue({ date, refresh, navigate }: { date: string; refresh: number; navigate: Navigate }) {
  const load = useCallback((signal: AbortSignal) => publicApi.getEdition(date, signal), [date]);
  const result = useReadingRequest(load, refresh);
  const downloadable = result.data?.status === 'published' || result.data?.status === 'empty';
  return <>
    <div className="reading-list-head">
      <div><h2><time dateTime={date}>{date}</time></h2>
        {result.data?.publishedAt && <span>出刊 {displayTime(result.data.publishedAt)}</span>}
      </div>
      {downloadable && <div className="reading-action-row">
        <a className="reading-link" href={publicApi.exportReportUrl({ type: 'daily', date })}><Download aria-hidden="true" />Markdown</a>
        <a className="reading-link" href={`/api/public/reports/daily?date=${encodeURIComponent(date)}`} download={`acg-pulse-${date}.json`}><Download aria-hidden="true" />JSON</a>
      </div>}
    </div>
    {Boolean(result.error) && <RequestNotice retry={result.retry}>{result.data ? '刷新刊期失败，显示上次加载的内容。' : '暂时无法读取这一期。'}</RequestNotice>}
    {result.loading && !result.data && <p className="reading-empty" role="status">正在加载日报…</p>}
    {result.data && <EditionContent data={result.data} navigate={navigate} />}
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
  useEffect(() => {
    if (event && id !== event.id) onResolveAliases([{ id: event.id, legacyIds: [id] }]);
  }, [event, id, onResolveAliases]);
  const missing = result.error instanceof ApiError && result.error.status === 404;
  // Do not show stale event content if a refresh confirms withdrawal or deletion.
  const visible = event && !missing;
  const latestProgress = event?.progress[0];
  const primary = event?.sources[0];
  const primaryUrl = latestProgress?.url || primary?.url;
  const primaryName = latestProgress?.source.name || primary?.sourceName;
  return (
    <section className="reading-panel glass-panel">
      <nav className="reading-back" aria-label="返回列表">
        <ReadingLink to={back || '/all'} navigate={navigate}><ArrowLeft aria-hidden="true" />返回列表</ReadingLink>
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
        <div className="reading-entry-foot reading-event-primary">
          {primaryName && (originalUrl(primaryUrl) ? <Original url={primaryUrl}>{primaryName} · 原文</Original> : <span>{primaryName}</span>)}
          {event.lastProgressAt ? <time dateTime={event.lastProgressAt}>最近进展 {displayTime(event.lastProgressAt)}</time>
            : <time dateTime={event.firstPublishedAt ?? undefined}>首报 {displayTime(event.firstPublishedAt)}</time>}
        </div>
        {event.progress.length > 0 && <section className="reading-detail-section">
          <h2>实质进展</h2>
          <ul className="reading-source-list">{event.progress.map(item => <FeedItemLink item={item} key={item.id} />)}</ul>
        </section>}
        <details className="reading-minor-details reading-event-reports">
          <summary>相关报道与原文（{event.sources.length}）</summary>
          <dl className="reading-event-times">
            <div><dt>首报时间</dt><dd>{displayTime(event.firstPublishedAt)}</dd></div>
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
