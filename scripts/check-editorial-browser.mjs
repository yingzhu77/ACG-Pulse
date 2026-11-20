// Real Chromium acceptance test against the disposable preview only.
// Requires Playwright available to Node (e.g. NODE_PATH). A normal installed
// Playwright browser is used unless ACG_PULSE_CHROMIUM_PATH is specified.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const evidence = resolve(here, '../tmp/editorial-qa');
const port = process.env.ACG_PULSE_PREVIEW_PORT ?? '3012';
assert.match(port, /^\d{4,5}$/);
assert(Number(port) >= 1024 && Number(port) <= 65535);
const origin = `http://127.0.0.1:${port}`;
const harbor = '雾港纪行（虚构作品）';
const sand = '鸣砂邮局（虚构作品）';
const quiet = '林梢电台（虚构作品）';
const stale = '古桥列岛（虚构作品）';
// The assertions below deliberately model the reading states the fixture buys
// us; a test that only checks an HTTP response cannot pass this gate.
const freshEmpty = /今天暂无值得精选的新内容/;
const staleNotice = /来源更新延迟/;
const partialNotice = /来源采集失败|来源失败|部分来源.*失败/;
const incompleteNotice = /待分析|分析尚未|分析中/;
const titlePattern = /跨区邮路开放.*长途委托/;
const artifacts = [];

async function waitText(scope, match) {
  await scope.getByText(match).first().waitFor({ timeout: 8000 });
}
async function viewportFits(page, width) {
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth
  }));
  assert.equal(dimensions.width, width);
  assert(Math.max(dimensions.html, dimensions.body) <= width + 1, 'page horizontally overflows: ' + JSON.stringify(dimensions));
}
async function screenshot(page, file) {
  const path = join(evidence, file);
  await page.screenshot({ path, animations: 'disabled' });
  artifacts.push(path);
}

async function testReading(browser, name, width, height) {
  const context = await browser.newContext({
    viewport: { width, height }, reducedMotion: 'reduce', locale: 'zh-CN', acceptDownloads: true
  });
  // The preview contains only synthetic data; block all non-loopback requests.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  try {
    let page = await context.newPage();
    await page.goto(origin);
    const selectedWork = () => page.getByRole('combobox', { name: '作品' });
    const header = () => page.getByRole('heading', { name: '今日精选', exact: true });
    const entryTitles = () => page.locator('.reading-title-link');
    const openCoverage = async () => {
      await page.locator('.reading-health summary').click();
      await waitText(page, /最近检查/);
    };
    await header().waitFor();
    await selectedWork().selectOption(harbor);
    await openCoverage();
    await waitText(page, partialNotice);
    await waitText(page, /分析失败/);
    assert((await entryTitles().count()) > 0, 'partial source failure should not erase known-good stories');

    await selectedWork().selectOption(quiet);
    await waitText(page, freshEmpty);
    assert.equal(await entryTitles().count(), 0);
    await selectedWork().selectOption(stale);
    await openCoverage();
    await waitText(page, staleNotice);
    await waitText(page, /采集覆盖或内容处理尚不完整/);
    assert.equal(await entryTitles().count(), 0);
    assert.equal(await page.getByText(freshEmpty).count(), 0, 'stale empty and healthy empty should differ');

    await selectedWork().selectOption(sand);
    await openCoverage();
    await waitText(page, incompleteNotice);
    await waitText(page, staleNotice);
    const longTitle = () => page.getByRole('link', { name: titlePattern });
    await longTitle().waitFor();
    await viewportFits(page, width);
    if (name === 'desktop') await screenshot(page, 'r2-desktop-featured.png');
    if (name === 'mobile-390') await screenshot(page, 'r2-mobile-featured.png');

    // Exercise both hard reload and closing/reopening a tab within the same profile.
    await page.reload();
    await longTitle().waitFor();
    assert.equal(await selectedWork().inputValue(), sand);
    await page.close();
    page = await context.newPage();
    await page.goto(origin);
    await longTitle().waitFor();
    assert.equal(await selectedWork().inputValue(), sand);

    const target = entryTitles().last();
    await target.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    assert(scrollBefore > 0, name + ': insufficient fixture content to exercise list scroll restoration');
    const title = await target.innerText();
    const eventPath = await target.getAttribute('href');
    assert.match(eventPath, /^\/events\/evt_/);
    await target.click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, eventPath);
    const favorite = page.getByRole('button', { name: '收藏事件', exact: true });
    await favorite.click();
    await page.getByRole('button', { name: '已收藏', exact: true, pressed: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: '已收藏', exact: true, pressed: true }).waitFor();
    await viewportFits(page, width);
    if (name === 'mobile-390') await screenshot(page, 'r2-mobile-event.png');
    await page.getByRole('link', { name: '返回列表' }).or(page.getByRole('button', { name: '返回列表' })).click();
    await header().waitFor();
    await longTitle().waitFor();
    assert.equal(await selectedWork().inputValue(), sand);
    await page.waitForFunction(before => Math.abs(window.scrollY - before) <= 35, scrollBefore, { timeout: 8500 });

    await page.getByRole('button', { name: '日报', exact: true }).click();
    await page.getByRole('heading', { name: '日报存档', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Markdown', exact: true }).waitFor();
    await viewportFits(page, width);
    if (name === 'desktop') await screenshot(page, 'r2-desktop-archive.png');

    const originalLink = page.locator('a[href*="/preview-originals/"]').first();
    const originalPage = context.waitForEvent('page', { timeout: 8000 });
    await originalLink.click();
    const original = await originalPage;
    await waitText(original, /合成原文 · 非真实资讯/);
    assert(new URL(original.url()).pathname.startsWith('/preview-originals/'));
    await original.close();

    const downloadTask = page.waitForEvent('download', { timeout: 8000 });
    await page.getByRole('link', { name: 'Markdown', exact: true }).click();
    const download = await downloadTask;
    assert.match(download.suggestedFilename(), /\.md$/);
    const markdown = await readFile(await download.path(), 'utf8');
    assert.match(markdown, /雾钟码头开放/);
    assert.match(markdown, /北门信使/);
    console.log(`PASS: ${name} ${width}×${height}, restored scroll ${scrollBefore}px; work filter persisted across reload and reopen; favorite persisted; opened fixture original and downloaded Markdown.`);
  } finally {
    await context.close();
  }
}

await mkdir(evidence, { recursive: true });
const fixture = await fetch(origin + '/preview-mobile.html', { redirect: 'error' });
assert(fixture.ok && (await fixture.text()).includes('ACG Pulse 390 px 移动验收'),
  'Refusing to test anything except the synthetic fixture');
const binary = process.env.ACG_PULSE_CHROMIUM_PATH;
const args = process.env.ACG_PULSE_CHROMIUM_ARGS
  ? JSON.parse(process.env.ACG_PULSE_CHROMIUM_ARGS) : [];
assert(Array.isArray(args) && args.every(arg => typeof arg === 'string'));
const browser = await chromium.launch({ ...(binary ? { executablePath: binary } : {}), args });
try {
  console.log('Actual Chromium:', browser.version());
  await testReading(browser, 'desktop', 1280, 780);
  await testReading(browser, 'mobile-390', 390, 844);
  console.log('Screenshots:', artifacts.map(path => path.replace(resolve(here, '..') + '/', '')).join(', '));
} finally {
  await browser.close();
}
