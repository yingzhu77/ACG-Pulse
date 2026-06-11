import { describe, expect, test } from 'vitest';
import { CreateSourceSchema, UpdateSourceSchema } from '../validation.js';

describe('source validation', () => {
  test('parses boolean-like source fields on create', () => {
    const parsed = CreateSourceSchema.parse({
      name: 'Test Source',
      type: 'rss',
      game: '原神',
      isOfficial: 'true',
      followed: 'false',
      enabled: 'false'
    });

    expect(parsed.isOfficial).toBe(true);
    expect(parsed.followed).toBe(false);
    expect(parsed.enabled).toBe(false);
    expect(parsed.priority).toBe(50);
    expect(parsed.config).toBeNull();
  });

  test('does not apply create defaults on partial update', () => {
    const parsed = UpdateSourceSchema.parse({
      name: 'Renamed Source'
    });

    expect(parsed).toEqual({ name: 'Renamed Source' });
  });
});
