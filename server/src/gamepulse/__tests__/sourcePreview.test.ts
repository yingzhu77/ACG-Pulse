import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AdapterError, type SourceAdapter } from '../adapters/base.js';
import { previewSource, sanitizeErrorMessage } from '../services/sourcePreview.js';

const fetchMock = vi.fn<SourceAdapter['fetch']>();

vi.mock('../adapters/registry.js', () => ({
  getAdapter: (source: { type: string }) => {
    if (source.type === 'unsupported') {
      throw new AdapterError('Unsupported source type: unsupported token=secret', source.type);
    }
    return {
      type: source.type,
      fetch: fetchMock
    };
  }
}));

const draft = {
  name: 'Preview Source',
  type: 'rss',
  game: 'Test Game',
  url: 'https://example.com/feed.xml',
  uid: null,
  route: null,
  isOfficial: false,
  followed: false,
  enabled: true,
  priority: 50,
  config: null
};

describe('source preview service', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  test('returns a truncated read-only preview from adapter results', async () => {
    fetchMock.mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({
      externalId: String(index),
      itemKind: 'creator_video',
      title: `Item ${index}`,
      content: 'x'.repeat(400),
      url: `https://example.com/${index}`,
      authorName: 'Author',
      publishedAt: new Date('2026-07-01T00:00:00.000Z')
    })));

    const result = await previewSource(draft, 5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatchObject({ id: 'preview-source', name: draft.name });
    expect(result.source).toEqual({ name: draft.name, type: draft.type, game: draft.game });
    expect(result.items).toHaveLength(5);
    expect(result.totalFetched).toBe(6);
    expect(result.truncated).toBe(true);
    expect(result.items[0].contentSnippet.length).toBeLessThanOrEqual(283);
    expect(result.items[0].publishedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  test('limits preview size to at most 10 items', async () => {
    fetchMock.mockResolvedValue(Array.from({ length: 12 }, (_, index) => ({
      itemKind: 'official_post',
      title: `Item ${index}`,
      content: 'content',
      url: `https://example.com/${index}`
    })));

    const result = await previewSource(draft, 99);

    expect(result.items).toHaveLength(10);
    expect(result.totalFetched).toBe(12);
  });

  test('reports unsupported source type as a sanitized fetch failure', async () => {
    await expect(previewSource({ ...draft, type: 'unsupported' }, 5))
      .rejects.toMatchObject({
        statusCode: 422,
        message: 'Unsupported source type: unsupported token=[redacted]'
      });
  });

  test('reports adapter errors without leaking sensitive config', async () => {
    fetchMock.mockRejectedValue(new Error('upstream failed Cookie: SESSDATA=abc; Authorization: Bearer topsecret'));

    await expect(previewSource({ ...draft, config: '{"token":"secret"}' }, 5))
      .rejects.toMatchObject({
        statusCode: 422,
        message: expect.not.stringContaining('topsecret')
      });
  });

  test('treats empty adapter results as 422', async () => {
    fetchMock.mockResolvedValue([]);

    await expect(previewSource(draft, 5))
      .rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringContaining('returned no items')
      });
  });

  test('sanitizes common credential fragments', () => {
    const message = sanitizeErrorMessage('token=abc api_key=def Cookie: SESSDATA=ghi; Authorization: Bearer jkl {"apiKey":"mno","bili_jct":"pqr"}');

    expect(message).not.toContain('abc');
    expect(message).not.toContain('def');
    expect(message).not.toContain('ghi');
    expect(message).not.toContain('jkl');
    expect(message).not.toContain('mno');
    expect(message).not.toContain('pqr');
    expect(message).toContain('[redacted]');
  });
});
