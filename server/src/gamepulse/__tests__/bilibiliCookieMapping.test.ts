import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const defaultSources = readFileSync(new URL('../defaultSources.ts', import.meta.url), 'utf8');
const mainCompose = readFileSync(new URL('../../../../docker-compose.yml', import.meta.url), 'utf8');
const localCompose = readFileSync(new URL('../../../../docker-compose.rsshub.yml', import.meta.url), 'utf8');

function matchUids(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map(match => match[1]);
}

function defaultBilibiliUids(): string[] {
  return matchUids(defaultSources, /uid: '(\d+)'/g);
}

describe('Bilibili cookie mapping coverage', () => {
  test('production compose maps every default Bilibili source UID', () => {
    const expected = defaultBilibiliUids();
    const actual = matchUids(mainCompose, /BILIBILI_COOKIE_(\d+)=/g);

    expect(new Set(actual).size).toBe(actual.length);
    expect([...new Set(actual)].sort()).toEqual([...new Set(expected)].sort());
  });

  test('local compose maps every UID and falls back to the root cookie', () => {
    const expected = defaultBilibiliUids();
    const actual = matchUids(
      localCompose,
      /BILIBILI_COOKIE_(\d+):\s*\$\{BILIBILI_COOKIE_\d+:-\$\{BILIBILI_COOKIE\}\}/g
    );

    expect(new Set(actual).size).toBe(actual.length);
    expect([...new Set(actual)].sort()).toEqual([...new Set(expected)].sort());
  });

  test('the app service does not receive Bilibili cookies', () => {
    const appBlock = mainCompose.slice(
      mainCompose.indexOf('  app:'),
      mainCompose.indexOf('  rsshub:')
    );

    expect(appBlock).toContain('BILIBILI_DIRECT_API_FALLBACK');
    expect(appBlock).not.toMatch(/BILIBILI_COOKIE/);
  });
});
