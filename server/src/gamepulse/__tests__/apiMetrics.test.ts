import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  getApiMetricsSnapshot,
  normalizeApiRoute,
  recordApiRequest,
  resetApiMetrics,
} from '../observability/apiMetrics.js';

describe('API metrics collector', () => {
  beforeEach(() => {
    resetApiMetrics();
    process.env.API_METRICS_WINDOW_MS = '1000';
    process.env.API_METRICS_SAMPLE_LIMIT = '3';
    process.env.API_SLOW_REQUEST_MS = '100';
    process.env.API_CRITICAL_REQUEST_MS = '500';
  });

  afterEach(() => {
    delete process.env.API_METRICS_WINDOW_MS;
    delete process.env.API_METRICS_SAMPLE_LIMIT;
    delete process.env.API_SLOW_REQUEST_MS;
    delete process.env.API_CRITICAL_REQUEST_MS;
  });

  test('normalizes identifiers and removes query parameters', () => {
    expect(normalizeApiRoute('/api/admin/items/12345?hidden=true')).toBe('/api/admin/items/:id');
    expect(normalizeApiRoute('/api/admin/items/550e8400-e29b-41d4-a716-446655440000/retry')).toBe('/api/admin/items/:id/retry');
  });

  test('reports bounded-window latency percentiles and errors', () => {
    const now = 10_000;
    recordApiRequest({ timestamp: now - 2000, route: '/api/expired', durationMs: 900, statusCode: 500 });
    recordApiRequest({ timestamp: now - 300, route: '/api/public/stats', durationMs: 20, statusCode: 200 });
    recordApiRequest({ timestamp: now - 200, route: '/api/public/stats', durationMs: 120, statusCode: 200 });
    recordApiRequest({ timestamp: now - 100, route: '/api/public/stats', durationMs: 600, statusCode: 500 });
    recordApiRequest({ timestamp: now, route: '/api/public/stories', durationMs: 40, statusCode: 200 });

    const snapshot = getApiMetricsSnapshot(now);
    expect(snapshot.sampleCount).toBe(3);
    expect(snapshot.p50Ms).toBe(120);
    expect(snapshot.p95Ms).toBe(600);
    expect(snapshot.errorRate).toBe(33.3);
    expect(snapshot.slowRequests).toBe(2);
    expect(snapshot.criticalRequests).toBe(1);
    expect(snapshot.status).toBe('critical');
    expect(snapshot.routes[0]).toMatchObject({ route: '/api/public/stats', count: 2, p95Ms: 600 });
  });
});
