import crypto from 'crypto';
import * as cheerio from 'cheerio';
import type { Source } from '@prisma/client';
import type { SourceConfig } from './types.js';

export function parseSourceConfig(source: Pick<Source, 'config' | 'route'>): SourceConfig {
  const parsed = source.config ? safeJson<SourceConfig>(source.config, {}) : {};
  if (source.route && !parsed.route) {
    parsed.route = source.route;
  }
  return parsed;
}

export function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/$/, '').replace(/^http:\/\/www\./, 'https://').replace(/^https:\/\/www\./, 'https://');
}

export function contentHash(parts: Array<string | undefined | null>): string {
  const raw = parts.filter(Boolean).join('\n').trim();
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function stripHtml(value: string): string {
  const normalized = value.replace(/<br\s*\/?>/gi, '\n');
  const $ = cheerio.load(normalized);
  return $.text().replace(/\n{3,}/g, '\n\n').trim();
}

export function absoluteUrl(baseUrl: string, url: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

export function truncate(value: string | undefined | null, length: number): string | null {
  if (!value) return null;
  return value.length > length ? value.slice(0, length) : value;
}

export function getUserAgent(): string {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 GamePulse/1.0';
}
