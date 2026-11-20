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

function memoryStorage() {
  const values = new Map();
  const storage = () => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  });
  return { storage, values };
}

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
