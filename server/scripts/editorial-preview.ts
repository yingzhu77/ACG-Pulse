// Executed by scripts/editorial-preview.sh only; no network or model calls.
import { createHash } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

const root = process.env.ACG_PULSE_PREVIEW_ROOT;
const origin = process.env.ACG_PULSE_PREVIEW_ORIGIN;
if (!root || !isAbsolute(root) || !/^acg-editorial-preview\.[a-zA-Z0-9]{8}$/.test(basename(root))
  || !origin || !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(origin)
  || process.env.ACG_PULSE_OFFLINE !== '1'
  || process.env.DATABASE_URL !== `file:${join(root, 'editorial-preview.db')}`
  || dirname(process.cwd()) !== root) {
  throw new Error('Use scripts/editorial-preview.sh to create a disposable SQLite database.');
}
const dbPath = join(root, 'editorial-preview.db');
if (await realpath(dbPath) !== dbPath) throw new Error('Fixture database may not be a symlink.');

const { prisma } = await import('../src/db.js');
const { publishDailyEdition, shanghaiDate, shiftEditionDate } = await import('../src/gamepulse/reports/editorial.js');

const work = '雾港纪行（虚构作品）';
const now = new Date();
const today = shanghaiDate(now);
const yesterday = shiftEditionDate(today, -1);
const twoDaysAgo = shiftEditionDate(today, -2);
const beginning = new Date(`${today}T00:00:00+08:00`).getTime();
const elapsed = now.getTime() - beginning;
const todayAt = (fraction: number) => new Date(beginning + Math.floor(elapsed * fraction));
const yesterdayAt = (hhmm: string) => new Date(`${yesterday}T${hhmm}:00+08:00`);
const yesterdayFirst = yesterdayAt('10:07');
const fixtureTime = todayAt(0.03);
const sourceA = 'preview-studio';
const sourceB = 'preview-press';
const sourceC = 'preview-creator';
const sourceD = 'preview-festival';
const sourceE = 'preview-new-source';
const reportedKeywords = ['丹潮协议', '雾钟码头', '港区通行证'];

const items = [
  {
    slug: 'patch-notes', sourceId: sourceA, title: '《丹潮协议》1.4 版本更新说明：雾钟码头开放',
    body: '丹潮协议 1.4 更新后开放雾钟码头，已有港区通行证的玩家可在登录后从西侧入口进入。未领取通行证的玩家需先完成港务局引导任务。',
    summary: '丹潮协议 1.4 开放雾钟码头，已有通行证可直接进入。',
    reason: '准备探索新码头的玩家可以先确认通行证是否已领取。',
    publishedAt: yesterdayAt('10:00'), discoveredAt: yesterdayFirst, keywords: reportedKeywords, category: 'version'
  }, {
    slug: 'reprint', sourceId: sourceB, title: '《丹潮协议》1.4 版本更新说明：雾钟码头开放',
    body: '丹潮协议 1.4 更新后开放雾钟码头，已有港区通行证的玩家可在登录后从西侧入口进入。未领取通行证的玩家需先完成港务局引导任务。',
    summary: '丹潮协议 1.4 开放雾钟码头，已有通行证可直接进入。',
    reason: '与制作者公布的信息相同，未提供新增事实。',
    publishedAt: yesterdayAt('10:15'), discoveredAt: yesterdayAt('10:20'), keywords: reportedKeywords, category: 'version'
  }, {
    slug: 'follow-up', sourceId: sourceA, title: '《丹潮协议》1.4 版本维护结束时间推迟：雾钟码头入口延后开放',
    body: '丹潮协议 1.4 版本维护延长一小时，雾钟码头西侧入口开放时间相应推迟。港区通行证继续有效，昨日已领证的玩家无需再领。',
    summary: '维护延长一小时，雾钟码头西侧入口延迟开放。',
    reason: '计划进入码头的玩家需要调整登录时间，通行证继续有效。',
    publishedAt: todayAt(0.10), discoveredAt: todayAt(0.13), keywords: reportedKeywords, category: 'version'
  }, {
    slug: 'concert', sourceId: sourceA, title: '雾港纪行「月汐之声」配乐会周六直播',
    body: '月汐之声配乐会将在周六晚八点于雾港音乐厅直播，公开演出港城四季组曲。标注时间为北京时间，回放可在直播结束后查看。',
    summary: '月汐之声配乐会周六晚上八点直播，结束后有回放。',
    reason: '想看首播的玩家可记下直播时间，错过后可看回放。',
    publishedAt: todayAt(0.19), discoveredAt: todayAt(0.22), keywords: ['月汐之声', '配乐会', '港城四季组曲'], category: 'game_music'
  }, {
    slug: 'late', sourceId: sourceD, title: '「海风档案馆」报名将于今晚开放',
    body: '海风档案馆限量线上参观将在今晚八点开放报名。已加入雾港纪行账号测试的玩家可用原有账号报名，不需要另行注册。',
    summary: '海风档案馆今晚八点开放报名，老账号可直接使用。',
    reason: '活动尚未开始，迟收录的信息仍可用于报名。',
    publishedAt: yesterdayAt('19:00'), discoveredAt: todayAt(0.30), keywords: ['海风档案馆', '线上参观', '账号测试'], category: 'event'
  }, {
    slug: 'historical', sourceId: sourceE, title: '旧版「影灯工坊」开放通知（初次接入补录）',
    body: '旧版影灯工坊的历史公告记录了当时的开放流程及奖励。本条由新信源首次抓取到，仅用来验证历史内容不会进入今日精选。',
    summary: '历史开放公告，初次接入信源后补录。', reason: '已经过时。',
    publishedAt: new Date(`${twoDaysAgo}T11:00:00+08:00`), discoveredAt: todayAt(0.38),
    keywords: ['影灯工坊', '历史公告'], category: 'event', backfill: true
  }, {
    slug: 'unknown-date', sourceId: sourceA, title: '「无人浮标」同步维护说明（原文未标时间）',
    body: '无人浮标同步维护时暂时停止向航行簿写入新记录。维护期间可查看已有航行日志。公告没有标注发布时间，本条不能当作当天新闻。',
    summary: '维护期间不能写入新日志，原文没有标注发布时间。', reason: '发布时间未知。',
    publishedAt: null, discoveredAt: todayAt(0.46), keywords: ['无人浮标', '同步维护'], category: 'announcement'
  }, {
    slug: 'title-only', sourceId: sourceA, title: '「沉雾观测站」开放预告',
    body: '「沉雾观测站」开放预告',
    publishedAt: todayAt(0.48), discoveredAt: todayAt(0.51), keywords: ['沉雾观测站'], category: 'announcement', status: 'failed'
  }, {
    slug: 'creator-notes', sourceId: sourceC, title: '玩家自制：手工绘制北区夜航线路',
    body: '创作者沿北区旧航线用毛笔绘制夜航路线，记录码头路灯与旗语，作为自制攻略的手绘素材。内容不包含版本更新或时效性公告。',
    summary: '虚构创作者自制手绘航线，不是版本新闻。', reason: '可在关注投稿查看。',
    publishedAt: todayAt(0.61), discoveredAt: todayAt(0.63), keywords: ['北区夜航路线'],
    category: 'creator_video', kind: 'creator_video', importance: 'low'
  }
];

function escapeHtml(input: string) {
  return input.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!);
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
try {
  const existing = await prisma.feedItem.count();
  if (existing || await prisma.source.count()) throw new Error('Fixture seeding requires a new empty database.');
  const sources = [
    { id: sourceA, name: '样本 · 雾港制作组', isOfficial: true },
    { id: sourceB, name: '样本 · 潮汐电台', isOfficial: false },
    { id: sourceC, name: '样本 · 夜航手作社', isOfficial: false, followed: true },
    { id: sourceD, name: '样本 · 档案馆', isOfficial: true, healthStatus: 'degraded' },
    { id: sourceE, name: '样本 · 旧城记事簿', isOfficial: false }
  ];
  for (const source of sources) {
    await prisma.source.create({ data: {
      game: work, type: 'rss', healthStatus: 'healthy', lastSuccessAt: yesterdayAt('10:20'),
      lastCheckedAt: fixtureTime, firstIngestAt: source.id === sourceE ? fixtureTime : yesterdayFirst,
      ...source,
      ...(source.healthStatus ? { lastError: '合成样本：上游部分条目暂不可用' } : {})
    } });
    await prisma.sourceHealthLog.createMany({ data: [
      { sourceId: source.id, status: 'healthy', checkedAt: yesterdayAt('10:20') },
      { sourceId: source.id, status: source.healthStatus ?? 'healthy', checkedAt: fixtureTime }
    ] });
  }

  const staticRoot = join(root, 'client', 'dist');
  // Real 390px layout viewport in the browser, without device emulation tooling.
  await writeFile(join(staticRoot, 'preview-mobile.html'), `<!doctype html><html lang="zh-CN">
    <meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <title>ACG Pulse · 390 px 样本验收</title>
    <style>html,body{margin:0;background:#e9edf3}iframe{display:block;width:390px;height:844px;max-width:100vw;border:0}</style>
    <iframe src="/" title="ACG Pulse 390 px 移动验收"></iframe></html>`, 'utf8');
  const originals = join(staticRoot, 'preview-originals');
  await mkdir(originals, { recursive: true });
  for (const item of items) {
    const originalFile = `${item.slug}.html`;
    await writeFile(join(originals, originalFile),
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(item.title)}</title><body><main><p>ACG Pulse 工程验收 · 合成原文 · 非真实资讯</p><h1>${escapeHtml(item.title)}</h1><p>${escapeHtml(item.body)}</p><p>${item.publishedAt?.toISOString() ?? '原文未提供时间'}</p></main></body></html>`,
      'utf8'
    );
    const status = item.status ?? 'completed';
    await prisma.feedItem.create({ data: {
      id: `fixture-${item.slug}`, identityKey: `fixture:${item.slug}`,
      externalId: item.slug, sourceId: item.sourceId, sourceType: 'rss', game: work,
      title: item.title, content: item.body, url: `${origin}/preview-originals/${originalFile}`,
      itemKind: item.kind ?? 'official_post', publishedAt: item.publishedAt,
      createdAt: item.discoveredAt, fetchedAt: item.discoveredAt,
      contentHash: hash(item.slug), isSourceBackfill: item.backfill ?? false,
      analysis: { create: {
        status, category: status === 'completed' ? item.category : null,
        confidence: status === 'completed' ? 95 : 0, visibility: 'public',
        importance: item.importance ?? (status === 'completed' ? 'high' : 'low'),
        summary: item.summary ?? null, reason: item.reason ?? null,
        dedupKeywords: JSON.stringify(item.keywords), provider: 'fixture', model: 'fixture',
        analyzedAt: status === 'completed' ? item.discoveredAt : null,
        error: status === 'failed' ? '合成样本：模型暂不可用' : null
      } }
    } });
  }
  await publishDailyEdition(yesterday, now);
  console.log(`合成数据：${items.length} 条，测试刊期：${yesterday}，今日：${today}（Asia/Shanghai）`);
} finally {
  await prisma.$disconnect();
}
