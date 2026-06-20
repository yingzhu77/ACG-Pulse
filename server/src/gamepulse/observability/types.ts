// Keep this response contract aligned with shared/operations.ts for the client.
export type OperationalStatus = 'healthy' | 'warning' | 'critical';

export interface ApiRouteMetrics {
  route: string;
  count: number;
  averageMs: number;
  p95Ms: number;
  maxMs: number;
  errorRate: number;
}

export interface ApiMetricsSnapshot {
  windowMs: number;
  sampleCount: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  errorRate: number;
  slowRequests: number;
  criticalRequests: number;
  status: OperationalStatus;
  routes: ApiRouteMetrics[];
}

export interface OperationalMetrics {
  generatedAt: string;
  status: OperationalStatus;
  storage: {
    databaseBytes: number;
    walBytes: number;
    shmBytes: number;
    totalBytes: number;
    reusableBytes: number;
    status: OperationalStatus;
  };
  capacity: {
    feed: {
      visible: number;
      hidden: number;
      limit: number;
      usagePercent: number;
      status: OperationalStatus;
    };
    community: {
      total: number;
      stale: number;
      status: OperationalStatus;
    };
    healthLogs: number;
    analysisQueue: {
      open: number;
      failed: number;
      oldestOpenAt: string | null;
      status: OperationalStatus;
    };
  };
  api: ApiMetricsSnapshot;
}
