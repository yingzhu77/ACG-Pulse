const TRACKING_PARAMS = new Set([
  'from', 'spm_id_from', 'share_source', 'share_medium', 'timestamp',
  'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term'
]);

function extractPlatformIdentity(value: string): string | null {
  const bvid = value.match(/\bBV[0-9A-Za-z]+\b/i)?.[0];
  if (bvid) return `bilibili:${bvid.toUpperCase()}`;

  const mihoyo = value.match(/miyoushe\.com\/(\w+)\/article\/(\d+)/i);
  if (mihoyo) return `miyoushe:${mihoyo[1].toLowerCase()}:${mihoyo[2]}`;

  const ngaTid = value.match(/[?&]tid=(\d+)/i)?.[1];
  if (ngaTid) return `nga:${ngaTid}`;

  return null;
}

export function canonicalizeIdentityUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.protocol = 'https:';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return `${url.hostname}${url.pathname}${url.search}`;
  } catch {
    return value.trim().replace(/\/+$/, '').toLowerCase();
  }
}

export function buildFeedItemIdentityKey(item: { externalId?: string | null; url: string }): string {
  const combined = `${item.externalId || ''} ${item.url || ''}`;
  const platformIdentity = extractPlatformIdentity(combined);
  if (platformIdentity) return platformIdentity;

  const externalId = item.externalId?.trim();
  if (externalId && !/^https?:\/\//i.test(externalId)) {
    return `external:${externalId.normalize('NFKC').toLowerCase()}`;
  }

  return `url:${canonicalizeIdentityUrl(item.url)}`;
}
