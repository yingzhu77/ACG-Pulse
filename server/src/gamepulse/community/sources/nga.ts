import axios from 'axios';
import { filterValidItems, settleCommunityRequests } from './common.js';

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

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'"
};

export function sanitizeNgaContent(raw: string, maxLength = 200): string {
  return (raw || '')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, entity => HTML_ENTITIES[entity] || entity)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

async function fetchNgaHotPosts(fid: number, limit: number): Promise<NgaPost[]> {
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
  const body = response.data;
  if (body?.code !== 0 || !Array.isArray(body.result?.data)) {
    throw new Error(`NGA fid=${fid} failed or missing list (code=${body?.code}, message=${body?.msg || ''})`);
  }
  const posts: NgaPost[] = body.result.data;
  return filterValidItems(
    posts,
    post => Boolean(post?.tid)
      && typeof post.subject === 'string'
      && post.subject.trim().length > 0
      && Number.isFinite(post.postdate)
      && post.postdate > 0,
    `NGA fid=${fid}`
  ).slice(0, limit);
}

async function fetchNgaPostContent(tid: number): Promise<NgaPostContent[]> {
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
  const body = response.data;
  if (body?.code !== 0 || !Array.isArray(body.result)) {
    throw new Error(`NGA tid=${tid} failed or missing comments (code=${body?.code}, message=${body?.msg || ''})`);
  }
  return body.result.map((post: NgaPostContent) => ({
    content: sanitizeNgaContent(post.content || ''),
    author: post.author || ''
  }));
}

export interface NgaHotPostsResult {
  posts: NgaPost[];
  error?: string;
}

export async function fetchAllNgaHotPostsWithStatus(): Promise<NgaHotPostsResult> {
  const posts: NgaPost[] = [];
  const errors: string[] = [];
  const batchSize = 3;
  for (let i = 0; i < NGA_FORUMS.length; i += batchSize) {
    const batch = NGA_FORUMS.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(fid => fetchNgaHotPosts(fid, 8)));
    results.forEach(result => {
      if (result.status === 'fulfilled') posts.push(...result.value);
      else errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    });
    if (i + batchSize < NGA_FORUMS.length) await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (posts.length === 0 && errors.length > 0) {
    throw new AggregateError(errors, `NGA forums failed: ${errors.join(' | ')}`);
  }
  return { posts, error: errors.length ? errors.join(' | ') : undefined };
}

export async function fetchAllNgaHotPosts(): Promise<NgaPost[]> {
  return (await fetchAllNgaHotPostsWithStatus()).posts;
}

export async function fetchNgaComments(
  tids: number[],
  concurrency: number
): Promise<NgaPostContent[][]> {
  const results: NgaPostContent[][] = new Array(tids.length);
  for (let i = 0; i < tids.length; i += concurrency) {
    const batch = tids.slice(i, i + concurrency);
    await settleCommunityRequests(
      batch.map((tid, offset) => fetchNgaPostContent(tid)
        .then(comments => { results[i + offset] = comments; })),
      'NGA comments failed'
    );
    if (i + concurrency < tids.length) await new Promise(resolve => setTimeout(resolve, 300));
  }
  return results;
}
