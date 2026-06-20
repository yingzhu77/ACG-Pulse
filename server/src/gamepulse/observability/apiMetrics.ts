import { getApiMetricsConfig } from '../config.js';
import type { ApiMetricsSnapshot, ApiRouteMetrics, OperationalStatus } from './types.js';

interface ApiRequestSample {
  timestamp: number;
  route: string;
  durationMs: number;
  statusCode: number;
}

const samples: ApiRequestSample[] = [];

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * percentileValue) - 1);
  return round(sortedValues[Math.max(index, 0)]);
}

function statusForLatency(p95Ms: number, errorRate: number): OperationalStatus {
  const { slowRequestMs, criticalRequestMs } = getApiMetricsConfig();
  if (p95Ms >= criticalRequestMs || errorRate >= 10) return 'critical';
  if (p95Ms >= slowRequestMs || errorRate >= 2) return 'warning';
  return 'healthy';
}

function trimSamples(now: number): void {
  const { windowMs, sampleLimit } = getApiMetricsConfig();
  const cutoff = now - windowMs;
  while (samples.length > 0 && samples[0].timestamp < cutoff) samples.shift();
  if (samples.length > sampleLimit) samples.splice(0, samples.length - sampleLimit);
}

export function normalizeApiRoute(originalUrl: string): string {
  const pathname = originalUrl.split('?')[0];
  return pathname
    .split('/')
    .map(segment => (/^\d+$/.test(segment) || /^[0-9a-f-]{24,}$/i.test(segment) ? ':id' : segment))
    .join('/');
}

export function recordApiRequest(sample: ApiRequestSample): void {
  if (!sample.route.startsWith('/api/')) return;
  samples.push(sample);
  trimSamples(sample.timestamp);
}

function summarizeRoute(route: string, routeSamples: ApiRequestSample[]): ApiRouteMetrics {
  const durations = routeSamples.map(sample => sample.durationMs).sort((a, b) => a - b);
  const errorCount = routeSamples.filter(sample => sample.statusCode >= 500).length;
  return {
    route,
    count: routeSamples.length,
    averageMs: round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    p95Ms: percentile(durations, 0.95),
    maxMs: round(durations.at(-1) || 0),
    errorRate: round((errorCount / routeSamples.length) * 100),
  };
}

export function getApiMetricsSnapshot(now = Date.now()): ApiMetricsSnapshot {
  trimSamples(now);
  const { windowMs, slowRequestMs, criticalRequestMs } = getApiMetricsConfig();
  const durations = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
  const errorCount = samples.filter(sample => sample.statusCode >= 500).length;
  const routeGroups = new Map<string, ApiRequestSample[]>();
  for (const sample of samples) {
    routeGroups.set(sample.route, [...(routeGroups.get(sample.route) || []), sample]);
  }
  const routes = [...routeGroups.entries()]
    .map(([route, routeSamples]) => summarizeRoute(route, routeSamples))
    .sort((a, b) => b.p95Ms - a.p95Ms)
    .slice(0, 12);
  const p95Ms = percentile(durations, 0.95);
  const errorRate = samples.length > 0 ? round((errorCount / samples.length) * 100) : 0;

  return {
    windowMs,
    sampleCount: samples.length,
    averageMs: samples.length > 0 ? round(durations.reduce((sum, value) => sum + value, 0) / samples.length) : 0,
    p50Ms: percentile(durations, 0.5),
    p95Ms,
    maxMs: round(durations.at(-1) || 0),
    errorRate,
    slowRequests: samples.filter(sample => sample.durationMs >= slowRequestMs).length,
    criticalRequests: samples.filter(sample => sample.durationMs >= criticalRequestMs).length,
    status: statusForLatency(p95Ms, errorRate),
    routes,
  };
}

export function resetApiMetrics(): void {
  samples.length = 0;
}
