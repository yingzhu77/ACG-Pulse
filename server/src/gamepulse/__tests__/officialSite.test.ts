import axios from 'axios';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { previewSource } from '../services/sourcePreview.js';
import { SourcePreviewSchema } from '../validation.js';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));

const draft = SourcePreviewSchema.parse({
  name: '示例游戏官网', type: 'official_site', game: '示例游戏',
  url: 'https://game.example/news/', isOfficial: true
});

describe('official site collection through source preview', () => {
  beforeEach(() => vi.mocked(axios.get).mockReset());

  test('navigation cannot fill the candidate limit before articles', async () => {
    const navigation = Array.from({ length: 25 }, (_, i) => `<a href="/section/${i}">导航栏目入口 ${i}</a>`).join('');
    vi.mocked(axios.get).mockResolvedValue({ data: `<nav>${navigation}</nav><article><a href="/news/101">示例游戏版本更新公告</a></article>` });

    const result = await previewSource(draft);

    expect(result.totalFetched).toBe(1);
    expect(result.items[0].url).toBe('https://game.example/news/101');
  });

  test('uses configured article fields and filters URLs before applying the item limit', async () => {
    const categories = Array.from({ length: 25 }, (_, i) => `<div class="entry"><a class="detail" href="/category/${i}"><h2>文章栏目导航入口 ${i}</h2></a></div>`).join('');
    vi.mocked(axios.get).mockResolvedValue({ data: `${categories}
      <div class="entry"><a href="/category/all">全部分类入口</a><a class="detail" href="/news/101"><h2>示例版本更新说明</h2></a><time datetime="2026-10-18T08:00:00+08:00">10月18日</time></div>
      <div class="entry"><a class="detail" href="/news/101"><h2>重复的文章链接</h2></a></div>
      <div class="entry"><a class="detail" href="/news/102"><h2>维护公告</h2></a><time>日期待定</time></div>` });

    const result = await previewSource({ ...draft, config: JSON.stringify({
      articleSelector: '.entry', titleSelector: 'h2', linkSelector: 'a.detail', dateSelector: 'time',
      urlPattern: '^https://game\\.example/news/\\d+$'
    }) });

    expect(result.totalFetched).toBe(2);
    expect(result.items[0]).toMatchObject({ title: '示例版本更新说明', url: 'https://game.example/news/101', publishedAt: '2026-10-18T00:00:00.000Z' });
    expect(result.items[1].publishedAt).toBeNull();
  });

  test('parses an already downloaded RSS or Atom response without fetching again', async () => {
    for (const data of [
      '<rss><channel><item><title>示例游戏版本更新公告</title><link>https://game.example/news/101</link></item></channel></rss>',
      '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>示例游戏版本更新公告</title><link href="https://game.example/news/101"/></entry></feed>'
    ]) {
      vi.mocked(axios.get).mockReset().mockResolvedValue({ data });
      const result = await previewSource(draft);
      expect(result.items[0].url).toBe('https://game.example/news/101');
      expect(axios.get).toHaveBeenCalledTimes(1);
    }
  });
});
