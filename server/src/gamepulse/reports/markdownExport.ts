import type { PublicStory } from '../storyAggregation.js';

export interface ReportMeta {
  type: 'daily' | 'weekly';
  dateRange: { start: Date; end: Date };
  game?: string;
  category?: string;
  importance?: string;
}

const IMPORTANCE_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低'
};

const CATEGORY_LABEL: Record<string, string> = {
  announcement: '官方公告',
  event: '活动资讯',
  version: '版本更新',
  character: '角色情报',
  pv: 'PV 影像',
  game_music: '游戏EP',
  community: '社区热点',
  music: '最新音乐',
  trailer: 'ACG 内容',
  movie_trailer: '电影预告',
  creator_video: '创作者视频',
  other: '其他'
};

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[|*_~`]/g, '\\$&');
}

export function generateMarkdownReport(
  stories: PublicStory[],
  meta: ReportMeta
): string {
  const { type, dateRange, game, category, importance } = meta;
  const typeLabel = type === 'daily' ? '日报' : '周报';
  const dateStr = type === 'daily'
    ? formatDate(dateRange.start)
    : `${formatDate(dateRange.start)} ~ ${formatDate(dateRange.end)}`;

  // Compute summary stats
  const totalStories = stories.length;
  const totalSources = new Set(stories.flatMap(s => s.sources.map(src => src.sourceId))).size;
  const highCount = stories.filter(s => s.importance === 'high').length;
  const mediumCount = stories.filter(s => s.importance === 'medium').length;
  const lowCount = stories.filter(s => s.importance === 'low').length;

  // Group by game
  const byGame = new Map<string, PublicStory[]>();
  for (const story of stories) {
    const g = story.game || '未知';
    const arr = byGame.get(g) || [];
    arr.push(story);
    byGame.set(g, arr);
  }

  // Group by category
  const byCategory = new Map<string, PublicStory[]>();
  for (const story of stories) {
    const cat = story.category || 'other';
    const arr = byCategory.get(cat) || [];
    arr.push(story);
    byCategory.set(cat, arr);
  }

  const lines: string[] = [];

  // Title
  lines.push(`# ACG Pulse ${typeLabel}`);
  lines.push('');
  lines.push(`> ${dateStr}${game ? ` | 游戏: ${game}` : ''}${category ? ` | 分类: ${CATEGORY_LABEL[category] || category}` : ''}${importance ? ` | 重要性: ${IMPORTANCE_LABEL[importance] || importance}` : ''}`);
  lines.push('');

  // Summary
  lines.push('## 概览');
  lines.push('');
  lines.push(`| 指标 | 数值 |`);
  lines.push(`|------|------|`);
  lines.push(`| 故事总数 | ${totalStories} |`);
  lines.push(`| 独立来源 | ${totalSources} |`);
  lines.push(`| 高重要性 | ${highCount} |`);
  lines.push(`| 中重要性 | ${mediumCount} |`);
  lines.push(`| 低重要性 | ${lowCount} |`);
  lines.push('');

  // Game breakdown
  if (byGame.size > 1 || !game) {
    lines.push('## 按游戏分布');
    lines.push('');
    lines.push(`| 游戏 | 故事数 |`);
    lines.push(`|------|--------|`);
    for (const [g, items] of [...byGame.entries()].sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`| ${escapeMarkdown(g)} | ${items.length} |`);
    }
    lines.push('');
  }

  // Category breakdown
  if (byCategory.size > 0) {
    lines.push('## 按分类分布');
    lines.push('');
    lines.push(`| 分类 | 故事数 |`);
    lines.push(`|------|--------|`);
    for (const [cat, items] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`| ${escapeMarkdown(CATEGORY_LABEL[cat] || cat)} | ${items.length} |`);
    }
    lines.push('');
  }

  // Stories by game
  lines.push('## 故事详情');
  lines.push('');

  for (const [g, items] of [...byGame.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (byGame.size > 1) {
      lines.push(`### ${escapeMarkdown(g)}`);
      lines.push('');
    }

    for (const story of items) {
      const imp = IMPORTANCE_LABEL[story.importance] || story.importance;
      const cat = CATEGORY_LABEL[story.category || ''] || story.category || '';
      const published = story.publishedAt ? formatDateTime(new Date(story.publishedAt)) : '';
      const sourceNames = [...new Set(story.sources.map(s => s.sourceName))].join(', ');

      lines.push(`#### ${escapeMarkdown(story.canonicalTitle)}`);
      lines.push('');
      lines.push(`- **重要性**: ${imp} | **分类**: ${cat || '未分类'}`);
      if (published) lines.push(`- **发布时间**: ${published}`);
      lines.push(`- **来源**: ${escapeMarkdown(sourceNames)} (${story.sourceCount} 个来源)`);
      if (story.summary) lines.push(`- **摘要**: ${story.summary}`);
      lines.push('');

      // Source links
      if (story.sources.length > 0) {
        lines.push('  来源链接:');
        for (const src of story.sources.slice(0, 5)) {
          lines.push(`  - [${escapeMarkdown(src.title || src.sourceName)}](${src.url})`);
        }
        if (story.sources.length > 5) {
          lines.push(`  - ... 及其他 ${story.sources.length - 5} 个来源`);
        }
        lines.push('');
      }
    }
  }

  // Footer
  lines.push('---');
  lines.push(`*Generated by ACG Pulse at ${formatDateTime(new Date())}*`);
  lines.push('');

  return lines.join('\n');
}

/** Snapshot export mirrors the JSON cards, ordered by the stored issue rank. */
export function generateEditorialMarkdown(edition: {
  date: string;
  publishedAt: string | null;
  status: string;
  health: import('./editorial.js').EditorialHealth;
  withdrawnCount: number;
  stories: import('./editorial.js').EditorialStory[];
}): string {
  const { date, status, stories, publishedAt, withdrawnCount, health } = edition;
  const lines = ['# ACG Pulse 日报', '', `> ${date} · Asia/Shanghai`, ''];
  const shanghaiTime = (value: string) => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value));
  const text = (value: string) => value
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]#|]/g, '\\$&');

  if (publishedAt) lines.push(`出刊：${shanghaiTime(publishedAt)}`, '');
  if (health.failedSources || health.degradedSources || health.uncheckedSources || health.pendingAnalysis || health.failedAnalysis || health.unavailableAnalysis) {
    lines.push(
      `出刊时：${health.failedSources} 个信源失败、${health.degradedSources} 个降级、${health.uncheckedSources} 个未检查；${health.pendingAnalysis} 条待分析、${health.failedAnalysis} 条分析失败、${health.unavailableAnalysis} 条未启用模型。`,
      ''
    );
  }
  if (withdrawnCount) lines.push(`本期有 ${withdrawnCount} 条已撤回，不再展示。`, '');
  if (status === 'empty') lines.push('本期没有值得入选的新内容。', '');
  else if (!stories.length) lines.push('本期没有符合当前条件的可见条目。', '');

  const statusLabel = {
    available: '已有摘要', insufficient: '来源材料不足，未生成摘要',
    failed: '分析失败，请查看原文', pending: '分析尚未完成', unavailable: '未启用模型分析，请查看原文'
  } as const;
  for (const story of stories) {
    const editorial = story.editorial;
    lines.push(
      `## ${text(story.canonicalTitle)}`, '',
      `- ${editorial.kind === 'update' ? '新进展' : '新事件'}${editorial.late ? ' · 迟到收录' : ''} · ${text(story.game || '未标明作品')} · ${IMPORTANCE_LABEL[story.importance]}重要性`,
      `- 原文发布：${shanghaiTime(editorial.publishedAt)} · 首次发现：${shanghaiTime(editorial.discoveredAt)}`
    );
    if (editorial.selectedAt) lines.push(`- 本期入选：${shanghaiTime(editorial.selectedAt)}`);
    if (editorial.correctedAt) lines.push(`- 已更正：${shanghaiTime(editorial.correctedAt)}`);
    if (story.summary) lines.push(`- 摘要：${text(story.summary)}`);
    else lines.push(`- ${statusLabel[editorial.summaryStatus]}`);
    if (editorial.impact) lines.push(`- 为何重要：${text(editorial.impact)}`);
    for (const source of story.sources) {
      // The editorial selector accepts HTTP(S) only; angle delimiters preserve parentheses in URLs.
      const href = new URL(source.url).href.replace(/[<>]/g, character => encodeURIComponent(character));
      lines.push(`- 原文：[${text(source.sourceName)}](<${href}>)`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
