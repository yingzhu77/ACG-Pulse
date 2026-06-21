const XIAOHEIHE_SHARE_URL = 'https://api.xiaoheihe.cn/v3/bbs/app/api/web/share';

export function buildXiaoheiheTopicUrl(linkId: string | number): string {
  return `${XIAOHEIHE_SHARE_URL}?link_id=${encodeURIComponent(String(linkId))}`;
}

export function normalizeCommunityTopicUrl(topic: {
  id: string;
  source: string;
  url: string;
}): string {
  if (topic.source !== 'xiaoheihe') return topic.url;

  const linkId = topic.id.startsWith('xhh-') ? topic.id.slice(4) : '';
  return linkId ? buildXiaoheiheTopicUrl(linkId) : topic.url;
}
