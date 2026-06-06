import type { Source } from '@prisma/client';
import type { SourceAdapter } from './base.js';
import { AdapterError } from './base.js';
import { BilibiliVideoAdapter } from './bilibiliVideo.js';
import { OfficialSiteAdapter } from './officialSite.js';
import { RssAdapter } from './rss.js';
import { RssHubAdapter } from './rsshub.js';
import { TrendSourceAdapter } from './trend.js';

const adapters: SourceAdapter[] = [
  new RssAdapter(),
  new RssHubAdapter(),
  new BilibiliVideoAdapter(),
  new OfficialSiteAdapter(),
  new TrendSourceAdapter()
];

export function getAdapter(source: Source): SourceAdapter {
  const adapter = adapters.find(item => item.type === source.type);
  if (!adapter) {
    throw new AdapterError(`Unsupported source type: ${source.type}`, source.type);
  }
  return adapter;
}
