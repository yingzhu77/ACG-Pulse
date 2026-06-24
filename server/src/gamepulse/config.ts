function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getMaxFeedItems(): number {
  return Math.floor(positiveNumber(process.env.MAX_FEED_ITEMS, 2000));
}

export function getHealthLogRetentionDays(): number {
  return Math.floor(positiveNumber(process.env.HEALTH_LOG_RETENTION_DAYS, 30));
}

export function getCompletedAnalysisTaskRetentionDays(): number {
  return Math.floor(positiveNumber(process.env.ANALYSIS_TASK_COMPLETED_RETENTION_DAYS, 14));
}

export function getFailedAnalysisTaskRetentionDays(): number {
  return Math.floor(positiveNumber(process.env.ANALYSIS_TASK_FAILED_RETENTION_DAYS, 30));
}

export function getStatsCacheTtlMs(): number {
  return positiveNumber(process.env.STATS_CACHE_TTL_MS, 30_000);
}

export function getApiMetricsConfig() {
  return {
    windowMs: positiveNumber(process.env.API_METRICS_WINDOW_MS, 15 * 60 * 1000),
    sampleLimit: Math.floor(positiveNumber(process.env.API_METRICS_SAMPLE_LIMIT, 2000)),
    slowRequestMs: positiveNumber(process.env.API_SLOW_REQUEST_MS, 500),
    criticalRequestMs: positiveNumber(process.env.API_CRITICAL_REQUEST_MS, 1500),
  };
}
