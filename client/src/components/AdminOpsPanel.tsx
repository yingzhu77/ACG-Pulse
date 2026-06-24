import { Activity, Database, Gauge, HardDrive, RefreshCw } from 'lucide-react';
import type { OperationalMetrics, OperationalStatus } from '../services/api';
import { cn } from '../lib/utils';

interface AdminOpsPanelProps {
  metrics: OperationalMetrics | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}

const STATUS_LABELS: Record<OperationalStatus, string> = {
  healthy: '正常',
  warning: '注意',
  critical: '异常',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function AdminOpsPanel({ metrics, loading, error, onRefresh }: AdminOpsPanelProps) {
  return (
    <section className="drawer-card ops-panel" aria-busy={loading}>
      <div className="ops-heading">
        <div>
          <h3>运行状态</h3>
          <p>{metrics ? `最近 ${Math.round(metrics.api.windowMs / 60_000)} 分钟` : '容量与接口延迟'}</p>
        </div>
        <div className="ops-heading-actions">
          {metrics && <span className={cn('ops-status', metrics.status)}>{STATUS_LABELS[metrics.status]}</span>}
          <button className="icon-button" type="button" onClick={onRefresh} disabled={loading} aria-label="刷新运行状态" title="刷新运行状态">
            <RefreshCw className={cn('h-4 w-4', loading && 'spin-active')} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="ops-message error">{error}</div>
      ) : !metrics ? (
        <div className="ops-message">{loading ? '正在读取运行状态…' : '暂无运行状态'}</div>
      ) : (
        <>
          <div className="ops-metric-grid">
            <div className="ops-metric">
              <Database className="h-4 w-4" />
              <span>情报容量</span>
              <strong>{metrics.capacity.feed.visible} / {metrics.capacity.feed.limit}</strong>
            </div>
            <div className="ops-metric">
              <HardDrive className="h-4 w-4" />
              <span>数据库</span>
              <strong>{formatBytes(metrics.storage.totalBytes)}</strong>
            </div>
            <div className="ops-metric">
              <Gauge className="h-4 w-4" />
              <span>API P95</span>
              <strong>{metrics.api.p95Ms.toFixed(1)} ms</strong>
            </div>
            <div className="ops-metric">
              <Activity className="h-4 w-4" />
              <span>错误率</span>
              <strong>{metrics.api.errorRate.toFixed(1)}%</strong>
            </div>
          </div>

          <div className="ops-capacity" aria-label={`情报容量 ${metrics.capacity.feed.usagePercent}%`}>
            <div>
              <span>保留容量</span>
              <strong>{metrics.capacity.feed.usagePercent}%</strong>
            </div>
            <span className="ops-capacity-track">
              <span
                className={cn('ops-capacity-fill', metrics.capacity.feed.status)}
                style={{ width: `${Math.min(metrics.capacity.feed.usagePercent, 100)}%` }}
              />
            </span>
          </div>

          <dl className="ops-details">
            <div><dt>社区话题</dt><dd>{metrics.capacity.community.total}（过期 {metrics.capacity.community.stale}）</dd></div>
            <div><dt>隐藏情报</dt><dd>{metrics.capacity.feed.hidden}</dd></div>
            <div><dt>分析队列</dt><dd>{metrics.capacity.analysisQueue.open} 待处理 · {metrics.capacity.analysisQueue.failed} 失败</dd></div>
            <div>
              <dt>任务历史清理</dt>
              <dd>
                成功 {metrics.capacity.analysisQueue.historyCleanup.completedDeleted}
                {' · '}失败 {metrics.capacity.analysisQueue.historyCleanup.failedDeleted}
              </dd>
            </div>
            <div><dt>WAL / 可复用</dt><dd>{formatBytes(metrics.storage.walBytes)} / {formatBytes(metrics.storage.reusableBytes)}</dd></div>
          </dl>

          <div className="ops-routes">
            <span>慢接口</span>
            {metrics.api.routes.slice(0, 4).map(route => (
              <div key={route.route}>
                <code>{route.route}</code>
                <strong>{route.p95Ms.toFixed(1)} ms</strong>
              </div>
            ))}
            {metrics.api.routes.length === 0 && <p>等待 API 请求样本</p>}
          </div>
        </>
      )}
    </section>
  );
}
