import type { MouseEvent } from 'react';
import type { ViewMode } from '../constants';

export const viewPaths: Record<ViewMode, string> = {
  today: '/',
  feed: '/all',
  community: '/community',
  insights: '/insights',
  daily: '/daily'
};

export type ReadingRoute =
  | { view: 'event'; id: string }
  | { view: 'daily'; date?: string }
  | { view: 'today' | 'feed' | 'community' | 'insights' };

export function eventPath(id: string) {
  return '/events/' + encodeURIComponent(id);
}

export function editionPath(date: string) {
  return '/daily/' + encodeURIComponent(date);
}

export function readingRoute(path: string): ReadingRoute {
  const parts = path.split('/').filter(Boolean);
  const [root, detail] = parts;
  if (root === 'events' && detail) {
    try { return { view: 'event', id: decodeURIComponent(detail) }; } catch { return { view: 'today' }; }
  }
  if (root === 'daily') return { view: 'daily', date: detail };
  if (root === 'all') return { view: 'feed' };
  if (root === 'community') return { view: 'community' };
  if (root === 'insights') return { view: 'insights' };
  return { view: 'today' };
}

export function followInApp(
  event: MouseEvent<HTMLAnchorElement>,
  navigate: (path: string) => void
) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(event.currentTarget.pathname + event.currentTarget.search);
}

export function originalUrl(url: string | null | undefined): string | undefined {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href;
  } catch { /* no navigable original */ }
}
