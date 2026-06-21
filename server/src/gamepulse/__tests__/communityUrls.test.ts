import { describe, expect, it } from 'vitest';
import { buildXiaoheiheTopicUrl, normalizeCommunityTopicUrl } from '../communityUrls.js';

describe('community topic URLs', () => {
  it('builds the current Xiaoheihe web share URL', () => {
    expect(buildXiaoheiheTopicUrl(12345)).toBe(
      'https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?link_id=12345'
    );
  });

  it('repairs legacy Xiaoheihe URLs from the stable topic id', () => {
    expect(normalizeCommunityTopicUrl({
      id: 'xhh-67890',
      source: 'xiaoheihe',
      url: 'https://xiaoheihe.cn/bbs/app/share/detail/67890'
    })).toBe('https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?link_id=67890');
  });

  it('leaves other community sources unchanged', () => {
    expect(normalizeCommunityTopicUrl({
      id: 'nga-123',
      source: 'nga',
      url: 'https://nga.178.com/read.php?tid=123'
    })).toBe('https://nga.178.com/read.php?tid=123');
  });
});
