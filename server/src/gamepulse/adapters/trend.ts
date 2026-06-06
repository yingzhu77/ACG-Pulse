import type { Source } from '@prisma/client';
import type { RawFeedItem } from '../types.js';
import type { SourceAdapter } from './base.js';

export class TrendSourceAdapter implements SourceAdapter {
  type = 'trend' as const;

  async fetch(_source: Source): Promise<RawFeedItem[]> {
    // Reserved for v2: Weibo hot search, Bilibili popular, Baidu trends, Zhihu hot list.
    return [];
  }
}
