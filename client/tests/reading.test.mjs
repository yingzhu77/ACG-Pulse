import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Use the project's compiler so this suite also runs on the Node 20 CI image.
async function loadSource(name) {
  const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const { FEATURED_GAME_KEY, readFeaturedGame, writeFeaturedGame, resolveFeaturedGame } = await loadSource('featuredPreference');
const { distinctImpact } = await loadSource('readingCopy');
const { createEventReadState } = await loadSource('eventReadState');

function memoryStorage() {
  const values = new Map();
  const storage = () => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  });
  return { storage, values };
}

test('read events reopen only for unseen substantive reports, including simultaneous updates', () => {
  const { storage } = memoryStorage();
  const tab = createEventReadState(storage);
  const other = createEventReadState(storage);
  assert.equal(tab.hasRead('evt-a', []), false);
  tab.markRead('evt-a', []);
  assert.equal(other.hasRead('evt-a', []), true);
  assert.equal(other.hasRead('evt-b', []), false);
  assert.equal(other.hasRead('evt-a', ['progress-1']), false);
  other.markRead('evt-a', ['progress-1', 'progress-2']);
  tab.markRead('evt-a', ['progress-1']); // A delayed tab cannot overwrite the newer view.
  assert.equal(tab.hasRead('evt-a', ['progress-2', 'progress-1']), true);
  assert.equal(tab.hasRead('evt-a', ['progress-2']), true); // Withdrawing an old report adds no news.
  assert.equal(tab.hasRead('evt-a', ['progress-2', 'progress-3']), false);
  assert.equal(other.onlyUnread(), false);
  tab.setOnlyUnread(true);
  assert.equal(other.onlyUnread(), true);
});

test('blocked local storage still supports reading and filtering for this session', () => {
  const state = createEventReadState(() => { throw new Error('Storage unavailable'); });
  state.markRead('evt-a', ['progress']);
  state.setOnlyUnread(true);
  assert.equal(state.hasRead('evt-a', ['progress']), true);
  assert.equal(state.hasRead('evt-a', ['additional']), false);
  assert.equal(state.onlyUnread(), true);
  state.setOnlyUnread(false);
  assert.equal(state.onlyUnread(), false);
});

test('saved work is recovered after reload and clear persists all works', () => {
  const { storage, values } = memoryStorage();
  assert.equal(readFeaturedGame(storage), '');
  writeFeaturedGame('鸣砂邮局', storage);
  assert.equal(readFeaturedGame(storage), '鸣砂邮局');
  assert.equal(resolveFeaturedGame(readFeaturedGame(storage), ['雾港纪行', '鸣砂邮局']), '鸣砂邮局');
  writeFeaturedGame('', storage);
  assert.equal(readFeaturedGame(storage), '');
  assert.equal(values.has(FEATURED_GAME_KEY), false);
});

test('malformed preferences, removed sources and storage denial fall back safely', () => {
  const { storage, values } = memoryStorage();
  for (const stored of ['broken', '[]', '{"game":"鸣砂邮局"}', JSON.stringify('a\u0000b'), JSON.stringify('a'.repeat(101))]) {
    values.set(FEATURED_GAME_KEY, stored);
    assert.equal(readFeaturedGame(storage), '');
  }
  assert.equal(resolveFeaturedGame('已移除作品', null), '已移除作品', 'configuration is not yet known');
  assert.equal(resolveFeaturedGame('已移除作品', ['鸣砂邮局']), '');
  assert.equal(resolveFeaturedGame('已移除作品', []), '');
  const blocked = () => { throw new Error('SecurityError'); };
  assert.equal(readFeaturedGame(blocked), '');
  assert.doesNotThrow(() => writeFeaturedGame('鸣砂邮局', blocked));
  assert.doesNotThrow(() => writeFeaturedGame('', blocked));
});

test('only show an impact sentence that adds information beyond title and summary', () => {
  const title = '鸣砂邮局宣布 2.0 更新';
  const summary = '鸣砂邮局将于 11 月 20 日发布更新，加入可探索的北站区域。';
  assert.equal(distinctImpact('鸣砂邮局宣布2.0更新。', summary, title), null);
  assert.equal(distinctImpact('加入可探索的北站区域！', summary, title), null);
  assert.equal(distinctImpact('建议关注。', summary, title), null);
  assert.equal(distinctImpact('已经预约的账号可以直接进入公开测试。', summary, title), '已经预约的账号可以直接进入公开测试。');
});
