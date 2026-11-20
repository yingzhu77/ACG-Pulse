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
const secondWork = '鸣砂邮局（虚构作品）';
const quietWork = '林梢电台（虚构作品）';
const staleWork = '古桥列岛（虚构作品）';
const now = new Date();
const today = shanghaiDate(now);
const yesterday = shiftEditionDate(today, -1);
const twoDaysAgo = shiftEditionDate(today, -2);
const beginning = new Date(`${today}T00:00:00+08:00`).getTime();
const elapsed = now.getTime() - beginning;
const todayAt = (fraction: number) => new Date(beginning + Math.floor(elapsed * fraction));
const yesterdayAt = (hhmm: string) => new Date(`${yesterday}T${hhmm}:00+08:00`);
const yesterdayFirst = yesterdayAt('10:07');
// A recent source check remains recent even in an evening browser session.
const fixtureTime = new Date(now.getTime() - 2 * 60_000);
const staleTime = new Date(now.getTime() - 24 * 3_600_000);
const sourceA = 'preview-studio';
const sourceB = 'preview-press';
const sourceC = 'preview-creator';
const sourceD = 'preview-festival';
const sourceE = 'preview-new-source';
const sourceF = 'preview-offline';
const sourceG = 'preview-post-office';
const sourceH = 'preview-post-office-stale';
const sourceI = 'preview-radio';
const sourceJ = 'preview-islands';
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
    body: '丹潮协议 1.4 版本维护延长 1 小时，雾钟码头西侧入口开放时间从 20:00 推迟至 21:00。港区通行证继续有效，昨日已领证的玩家无需再领。',
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
  }, {
    slug: 'sand-post-office-yesterday', sourceId: sourceG, work: secondWork,
    title: '「北门信使」路线明日开通：第一批夜班邮差可登记',
    body: '鸣砂邮局将开通北门信使路线，第一批夜班邮差可登记领取任务。已完成寄件引导的玩家可在营地窗口登记，不需要重复完成新手教程。',
    summary: '北门信使路线明日开通，完成寄件引导即可报名。',
    reason: '想体验夜间配送的玩家可以提前完成寄件引导。',
    publishedAt: yesterdayAt('13:00'), discoveredAt: yesterdayAt('13:03'),
    keywords: ['北门信使', '夜班邮差', '寄件引导'], category: 'event'
  }, {
    slug: 'sand-post-office-long', sourceId: sourceG, work: secondWork,
    title: '「沙丘手记」2.7 版本更新说明：跨区邮路开放、旧版纪念戳将在维护后停止兑换，已接取的长途委托可在新的驿站继续交付',
    body: '沙丘手记 2.7 将开放跨区邮路，旧版纪念戳会在维护后停止兑换。已接取的长途委托可在新驿站继续交付，已有兑换记录不受影响。',
    summary: '跨区邮路开放；旧纪念戳维护后停兑；旧委托可以继续。',
    reason: '想兑换旧纪念戳的玩家应在维护前完成，进行中的委托无需取消。',
    publishedAt: todayAt(0.64), discoveredAt: todayAt(0.66),
    keywords: ['沙丘手记', '跨区邮路', '纪念戳'], category: 'version'
  }, ...([
    ['sand-post-office-collection', '「候鸟地图」实装：旅行记录支持标记附近驿站', '完成首条邮路后旅行记录可标记驿站；原有地图不变。', ['候鸟地图', '旅行记录', '驿站标记']],
    ['sand-post-office-compensation', '「沙砾补寄」补偿方案：丢失凭据可在驿站重发', '因昨日断线丢失的寄件凭据将补发，领取入口为邮局柜台。', ['沙砾补寄', '凭据补发', '邮局柜台']],
    ['sand-post-office-survey', '「南坡旧路」开放测试：预约用户今晚可提交试跑记录', '已登记南坡旧路试跑的玩家可提交运单，收到回执后即完成登记。', ['南坡旧路', '开放测试', '试跑运单']]
  ] as const).map(([slug, title, summary, keywords], index) => ({
    slug, sourceId: sourceG, work: secondWork, title, summary,
    body: `${summary} 样本公告仅描述已登记玩家的处理方法，其他邮路及现有委托不受影响。`,
    reason: '关注该项路线或委托的读者可提前核对邮局状态。',
    publishedAt: todayAt(0.70 + 0.02 * index), discoveredAt: todayAt(0.71 + 0.02 * index),
    keywords: [...keywords], category: 'event'
  })), {
    slug: 'sand-post-office-pending', sourceId: sourceG, work: secondWork,
    title: '「玻璃候鸟」制作札记',
    body: '制作札记介绍了新的候鸟路标原画和制作流程。这一条用于测试存在正文但 AI 分析还未完成时的提示，不应编造影响，也不应抢占精选。',
    publishedAt: todayAt(0.75), discoveredAt: todayAt(0.76),
    keywords: ['玻璃候鸟', '制作札记'], category: 'other', status: 'pending'
  }, {
    slug: 'radio-quiet', sourceId: sourceI, work: quietWork,
    title: '林梢电台旧版收音手册',
    body: '旧版收音手册说明如何查阅短波频段、保存既有频道。此旧文仅用于保证林梢电台作品可查看，而今日无值得入选事件。',
    summary: '旧版收音手册。', reason: '已不具有时效性。',
    publishedAt: new Date(`${twoDaysAgo}T09:00:00+08:00`), discoveredAt: new Date(`${twoDaysAgo}T10:00:00+08:00`),
    keywords: ['林梢电台', '收音手册'], category: 'other', importance: 'low'
  }, {
    slug: 'islands-quiet-and-stale', sourceId: sourceJ, work: staleWork,
    title: '古桥列岛旧版码头图册',
    body: '旧版图册标注了几座古桥的通行方向，本条用于让来源陈旧的作品可以从筛选中选择。',
    summary: '旧版码头图册。', reason: '已不具有时效性。',
    publishedAt: new Date(`${twoDaysAgo}T09:00:00+08:00`), discoveredAt: new Date(`${twoDaysAgo}T10:00:00+08:00`),
    keywords: ['古桥列岛', '码头图册'], category: 'other', importance: 'low'
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
    { id: sourceE, name: '样本 · 旧城记事簿', isOfficial: false },
    { id: sourceF, name: '样本 · 港口镜像', isOfficial: false, healthStatus: 'failed' },
    { id: sourceG, name: '样本 · 鸣砂邮局公告台', isOfficial: true, game: secondWork },
    { id: sourceH, name: '样本 · 沙丘档案镜像', isOfficial: false, game: secondWork, checkedAt: staleTime },
    { id: sourceI, name: '样本 · 林梢电台公告台', isOfficial: true, game: quietWork },
    { id: sourceJ, name: '样本 · 古桥列岛播报', isOfficial: true, game: staleWork, checkedAt: staleTime }
  ];
  for (const source of sources) {
    const { checkedAt = fixtureTime, ...data } = source;
    await prisma.source.create({ data: {
      game: work, type: 'rss', healthStatus: 'healthy',
      lastSuccessAt: data.healthStatus ? yesterdayAt('10:20') : checkedAt,
      lastCheckedAt: checkedAt, createdAt: source.id === sourceE ? fixtureTime : yesterdayFirst,
      firstIngestAt: source.id === sourceE ? fixtureTime : yesterdayFirst,
      ...data,
      ...(data.healthStatus ? { lastError: '合成样本：上游部分条目暂不可用' } : {})
    } });
    await prisma.sourceHealthLog.createMany({ data: [
      { sourceId: source.id, status: 'healthy', checkedAt: yesterdayAt('10:20') },
      { sourceId: source.id, status: data.healthStatus ?? 'healthy', checkedAt }
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
      externalId: item.slug, sourceId: item.sourceId, sourceType: 'rss', game: item.work ?? work,
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
