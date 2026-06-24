import axios from 'axios';

export interface NgaPost {
  tid: number;
  fid: number;
  author: string;
  subject: string;
  postdate: number;
  replies: number;
  lastpost: number;
}

export interface NgaPostContent {
  content: string;
  author: string;
}

const NGA_FORUMS = [476, 650, 341, 710, 694, 447];

async function fetchNgaHotPosts(fid: number, limit: number): Promise<NgaPost[]> {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await axios.post(
      'https://ngabbs.com/app_api.php?__lib=subject&__act=list',
      new URLSearchParams({ fid: String(fid), recommend: '0' }).toString(),
      {
        headers: {
          'X-User-Agent': 'NGA_skull/6.0.5(iPhone10,3;iOS 12.0.1)',
          'Cookie': `guestJs=${timestamp}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10_000
      }
    );
    if (response.data.code !== 0 || !response.data.result?.data) return [];
    return (response.data.result.data || [])
      .filter((post: NgaPost) => post.tid)
      .slice(0, limit);
  } catch (error) {
    console.error(`[Community] NGA fid=${fid} error:`, (error as Error).message);
    return [];
  }
}

async function fetchNgaPostContent(tid: number): Promise<NgaPostContent[]> {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await axios.post(
      'https://ngabbs.com/app_api.php?__lib=post&__act=list',
      new URLSearchParams({ tid: String(tid) }).toString(),
      {
        headers: {
          'X-User-Agent': 'NGA_skull/6.0.5(iPhone10,3;iOS 12.0.1)',
          'Cookie': `guestJs=${timestamp}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10_000
      }
    );
    if (response.data.code !== 0 || !response.data.result) return [];
    return (response.data.result || []).map((post: NgaPostContent) => ({
      content: (post.content || '').replace(/\[.*?\]/g, '').slice(0, 200),
      author: post.author || ''
    }));
  } catch {
    return [];
  }
}

export async function fetchAllNgaHotPosts(): Promise<NgaPost[]> {
  const posts: NgaPost[] = [];
  const batchSize = 3;
  for (let i = 0; i < NGA_FORUMS.length; i += batchSize) {
    const batch = NGA_FORUMS.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map(fid => fetchNgaHotPosts(fid, 8)));
    settled.forEach(item => {
      if (item.status === 'fulfilled') posts.push(...item.value);
      else console.error('[Community] NGA batch error:', item.reason);
    });
    if (i + batchSize < NGA_FORUMS.length) await new Promise(resolve => setTimeout(resolve, 500));
  }
  return posts;
}

export async function fetchNgaComments(
  tids: number[],
  concurrency: number
): Promise<NgaPostContent[][]> {
  const results: NgaPostContent[][] = new Array(tids.length);
  for (let i = 0; i < tids.length; i += concurrency) {
    const batch = tids.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((tid, offset) => fetchNgaPostContent(tid)
        .then(comments => { results[i + offset] = comments; }))
    );
    settled.forEach(item => {
      if (item.status === 'rejected') console.error('[Community] NGA comment error:', item.reason);
    });
    if (i + concurrency < tids.length) await new Promise(resolve => setTimeout(resolve, 300));
  }
  return results;
}
