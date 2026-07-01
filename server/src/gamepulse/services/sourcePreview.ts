import type { Source } from '@prisma/client';
import type { CreateSourceInput } from '../validation.js';
import { AdapterError } from '../adapters/base.js';
import { getAdapter } from '../adapters/registry.js';

const DEFAULT_PREVIEW_LIMIT = 5;
const MAX_PREVIEW_LIMIT = 10;
const PREVIEW_TIMEOUT_MS = 15_000;
const SNIPPET_MAX_LENGTH = 280;

interface SourcePreviewResponse {
  ok: true;
  source: {
    name: string;
    type: string;
    game: string;
  };
  items: Array<{
    title: string;
    url: string;
    authorName: string | null;
    publishedAt: string | null;
    itemKind: string;
    contentSnippet: string;
  }>;
  totalFetched: number;
  truncated: boolean;
  warnings: string[];
}

export class SourcePreviewError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 422 | 500 = 422
  ) {
    super(message);
    this.name = 'SourcePreviewError';
  }
}

export async function previewSource(
  draft: CreateSourceInput,
  requestedLimit = DEFAULT_PREVIEW_LIMIT
): Promise<SourcePreviewResponse> {
  const limit = clampPreviewLimit(requestedLimit);
  const source = buildPreviewSource(draft);

  let items;
  try {
    items = await withTimeout(
      getAdapter(source).fetch(source),
      PREVIEW_TIMEOUT_MS,
      'Source preview timed out. Try a smaller route or check whether the upstream source is reachable.'
    );
  } catch (error) {
    if (error instanceof AdapterError) {
      throw new SourcePreviewError(sanitizeErrorMessage(error.message), 422);
    }
    throw new SourcePreviewError(sanitizeErrorMessage(error), 422);
  }

  if (!items.length) {
    throw new SourcePreviewError('Source preview returned no items. Check the URL, UID, route, or upstream availability.', 422);
  }

  const previewItems = items.slice(0, limit).map(item => ({
    title: truncateText(item.title, 160),
    url: truncateText(item.url, 300),
    authorName: item.authorName ? truncateText(item.authorName, 80) : null,
    publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
    itemKind: item.itemKind,
    contentSnippet: truncateText(item.content, SNIPPET_MAX_LENGTH)
  }));

  return {
    ok: true,
    source: {
      name: source.name,
      type: source.type,
      game: source.game
    },
    items: previewItems,
    totalFetched: items.length,
    truncated: items.length > previewItems.length || items.some(item => (item.content || '').length > SNIPPET_MAX_LENGTH),
    warnings: items.length > limit ? [`Fetched ${items.length} items; showing the first ${previewItems.length}.`] : []
  };
}

function buildPreviewSource(draft: CreateSourceInput): Source {
  const now = new Date();
  return {
    id: 'preview-source',
    name: draft.name,
    type: draft.type,
    game: draft.game,
    url: draft.url,
    uid: draft.uid,
    avatar: null,
    route: draft.route,
    config: draft.config,
    isOfficial: draft.isOfficial,
    followed: draft.followed,
    enabled: draft.enabled,
    priority: draft.priority,
    healthStatus: 'unknown',
    lastSuccessAt: null,
    lastCheckedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now
  };
}

function clampPreviewLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PREVIEW_LIMIT;
  return Math.min(MAX_PREVIEW_LIMIT, Math.max(1, Math.trunc(value)));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new SourcePreviewError(timeoutMessage, 422)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function truncateText(value: string, maxLength: number): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || 'Source preview failed');
  return raw
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s|;,)]+/gi, '$1[redacted]')
    .replace(/(cookie\s*[:=]\s*)[^|)]+/gi, '$1[redacted]')
    .replace(/((?:token|api[_-]?key|sessdata|bili_jct|dedeuserid)\s*[:=]\s*)[^&\s|;,)]+/gi, '$1[redacted]')
    .replace(/(["'](?:token|api[_-]?key|sessdata|bili_jct|dedeuserid)["']\s*:\s*["'])[^"']+(["'])/gi, '$1[redacted]$2')
    .slice(0, 300);
}
