// Smoke-test the running synthetic preview, not a production instance.
import assert from 'node:assert/strict';

const port = process.env.ACG_PULSE_PREVIEW_PORT ?? '3012';
assert.match(port, /^\d{4,5}$/);
assert(Number(port) >= 1024 && Number(port) <= 65535);
const origin = `http://127.0.0.1:${port}`;
const reports = '/api/public/reports';
async function local(path) {
  assert(path.startsWith('/') && !path.startsWith('//'), 'only local preview paths are permitted');
  const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return response;
}
const json = async path => (await local(path)).json();
const desktop = await local('/');
const mobile = await local('/preview-mobile.html');
assert(desktop.headers.get('content-type')?.startsWith('text/html'));
assert.match(await mobile.text(), /ACG Pulse 390 px 移动验收/);
const featured = await json(reports + '/featured');
assert.equal(featured.status, 'live');
assert.equal(featured.health.degradedSources, 1);
assert.equal(featured.health.failedAnalysis, 1);
assert.equal(featured.stories.length, 3);
assert(featured.stories.every(story => !/影灯工坊|同步维护说明|手工绘制/.test(story.canonicalTitle)));
const update = featured.stories.find(story => story.editorial.kind === 'update' && /雾钟码头/.test(story.canonicalTitle));
assert(update, 'expected an update for the previously announced Dan-Chao version');
assert(featured.stories.some(story => story.editorial.kind === 'new' && /月汐之声/.test(story.canonicalTitle)));
assert(featured.stories.some(story => story.editorial.late && /海风档案馆/.test(story.canonicalTitle)));
const detail = (await json('/api/public/stories/' + encodeURIComponent(update.id))).data;
assert.equal(detail.id, update.id);
assert.equal(detail.progress.length, 1);
assert.match(detail.progress[0].title, /维护结束时间推迟/);
assert(detail.firstPublishedAt < detail.lastProgressAt);
assert.match(detail.summary, /维护延长一小时/);
assert(detail.sources.length >= 2);
for (const source of detail.sources) {
  const original = new URL(source.url);
  assert.equal(original.origin, origin);
  assert(original.pathname.startsWith('/preview-originals/'));
  assert.match(await (await local(original.pathname)).text(), /合成原文/);
}
const archive = await json(reports + '/editions');
const issuePath = reports + '/daily?date=' + encodeURIComponent(archive.data[0].date);
const issue = await json(issuePath);
assert.equal(issue.status, 'published');
assert.equal(issue.stories.length, 1);
assert.equal(issue.stories[0].id, detail.id);
assert.equal(issue.stories[0].editorial.kind, 'new');
const exportResponse = await local(reports + '/export?type=daily&date=' + encodeURIComponent(issue.date));
assert(exportResponse.headers.get('content-type')?.startsWith('text/markdown'));
const markdown = await exportResponse.text();
assert(markdown.includes(issue.stories[0].canonicalTitle));
assert(markdown.includes(issue.stories[0].sources[0].url));
assert.deepEqual(await json(issuePath), issue);
console.log('PASS: 桌面和 390 px HTML 入口、精选与部分故障、稳定事件进展、合成原文、往期日报与导出一致；此脚本不代替浏览器交互验收。');
