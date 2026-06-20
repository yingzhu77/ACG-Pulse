import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Lock, LogOut, Play, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import type { AnalysisQueueOverview, OperationalMetrics, Source } from '../services/api';
import { AdminOpsPanel } from './AdminOpsPanel';

export interface SourceDraft {
  name: string;
  game: string;
  type: string;
  uid: string;
  url: string;
  route: string;
  isOfficial: boolean;
}

export interface AdminDrawerProps {
  open: boolean;
  onClose: () => void;
  token: string | null;
  password: string;
  setPassword: (value: string) => void;
  onLogin: (event: React.FormEvent) => void;
  onLogout: () => void;
  sources: Source[];
  sourceDraft: SourceDraft;
  setSourceDraft: React.Dispatch<React.SetStateAction<SourceDraft>>;
  onCreateSource: (event: React.FormEvent) => void;
  onSeedDefaults: () => void;
  onRunCheck: () => void;
  onReanalyzeAll: () => void;
  analysisQueue: AnalysisQueueOverview | null;
  operationalMetrics: OperationalMetrics | null;
  operationalMetricsLoading: boolean;
  operationalMetricsError: string;
  onRefreshOperationalMetrics: () => void;
  onRetryAnalysisTask: (id: string) => void;
  onRetryFailedAnalysisTasks: () => void;
  onToggleSource: (id: string) => void;
  followUrl: string;
  setFollowUrl: (value: string) => void;
  followName: string;
  setFollowName: (value: string) => void;
  onFollowUrl: (event: React.FormEvent) => void;
  bilibiliCookie: string;
  setBilibiliCookie: (value: string) => void;
  onSaveCookie: () => void;
}

export function AdminDrawer(props: AdminDrawerProps) {
  const failedTaskCount = props.analysisQueue
    ? props.analysisQueue.counts.failed || 0
    : undefined;

  return (
    <AnimatePresence>
      {props.open && (
        <motion.div className="drawer-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.aside
            initial={{ x: 420 }}
            animate={{ x: 0 }}
            exit={{ x: 420 }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="admin-drawer"
          >
            <div className="drawer-heading">
              <div>
                <p>Private Console</p>
                <h2>Game Pulse 后台</h2>
              </div>
              <button onClick={props.onClose} className="icon-button" aria-label="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>

            {!props.token ? (
              <form onSubmit={props.onLogin} className="admin-form">
                <label>管理员密码</label>
                <input
                  type="password"
                  value={props.password}
                  onChange={event => props.setPassword(event.target.value)}
                  className="admin-input"
                />
                <button className="action-button primary">
                  <Lock className="h-4 w-4" />
                  解锁后台
                </button>
              </form>
            ) : (
              <div className="drawer-stack">
                <div className="drawer-actions">
                  <button onClick={props.onSeedDefaults} className="action-button">
                    <Plus className="h-4 w-4" />
                    准备默认源
                  </button>
                  <button onClick={props.onRunCheck} className="action-button primary">
                    <Play className="h-4 w-4" />
                    手动检查
                  </button>
                  <button onClick={props.onReanalyzeAll} className="action-button">
                    <RefreshCw className="h-4 w-4" />
                    重新分类
                  </button>
                  <button onClick={props.onLogout} className="action-button">
                    <LogOut className="h-4 w-4" />
                    退出
                  </button>
                </div>

                <AdminOpsPanel
                  metrics={props.operationalMetrics}
                  loading={props.operationalMetricsLoading}
                  error={props.operationalMetricsError}
                  onRefresh={props.onRefreshOperationalMetrics}
                />

                <div className="drawer-card">
                  <div className="queue-heading">
                    <h3>AI 分析队列</h3>
                    {failedTaskCount === undefined ? (
                      <span className="queue-heading-status">读取队列...</span>
                    ) : failedTaskCount > 0 ? (
                      <button
                        onClick={props.onRetryFailedAnalysisTasks}
                        className="action-button queue-retry-button"
                        type="button"
                      >
                        <RotateCcw className="h-4 w-4" />
                        重试失败任务
                      </button>
                    ) : (
                      <span className="queue-heading-status healthy" role="status" aria-live="polite">
                        <CheckCircle2 className="h-4 w-4" />
                        无失败任务
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 10 }}>
                    {['pending', 'running', 'completed', 'failed'].map(status => (
                      <div key={status} className="queue-stat">
                        <span>{status}</span>
                        <strong>{props.analysisQueue?.counts[status] || 0}</strong>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                    {(props.analysisQueue?.recentTasks || []).slice(0, 5).map(task => (
                      <div key={task.id} className="queue-task-row">
                        <div>
                          <p>{task.feedItem.title}</p>
                          <span>
                            {task.status} · {task.retryCount}/{task.maxRetries} · {task.feedItem.source.name}
                          </span>
                          {task.lastError && <em>{task.lastError}</em>}
                        </div>
                        {task.status === 'failed' && (
                          <button onClick={() => props.onRetryAnalysisTask(task.id)} type="button" className="icon-button" aria-label="重试任务">
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    {!props.analysisQueue?.recentTasks.length && (
                      <p style={{ color: 'var(--text-soft)', fontSize: 13, margin: 0 }}>暂无分析任务</p>
                    )}
                  </div>
                </div>

                <form onSubmit={props.onCreateSource} className="drawer-card">
                  <h3>添加权威 UP / 官方源</h3>
                  <div className="form-grid">
                    <input value={props.sourceDraft.name} onChange={event => props.setSourceDraft(prev => ({ ...prev, name: event.target.value }))} placeholder="源名称" className="admin-input" />
                    <input value={props.sourceDraft.game} onChange={event => props.setSourceDraft(prev => ({ ...prev, game: event.target.value }))} placeholder="游戏" className="admin-input" />
                    <select value={props.sourceDraft.type} onChange={event => props.setSourceDraft(prev => ({ ...prev, type: event.target.value }))} className="admin-input">
                      <option value="bilibili_video">B站投稿</option>
                      <option value="rsshub">RSSHub</option>
                      <option value="rss">RSS</option>
                      <option value="official_site">官网</option>
                    </select>
                    <input value={props.sourceDraft.uid} onChange={event => props.setSourceDraft(prev => ({ ...prev, uid: event.target.value }))} placeholder="B站 UID" className="admin-input" />
                    <input value={props.sourceDraft.url} onChange={event => props.setSourceDraft(prev => ({ ...prev, url: event.target.value }))} placeholder="URL" className="admin-input wide" />
                    <input value={props.sourceDraft.route} onChange={event => props.setSourceDraft(prev => ({ ...prev, route: event.target.value }))} placeholder="RSSHub route" className="admin-input wide" />
                  </div>
                  <label className="check-line">
                    <input type="checkbox" checked={props.sourceDraft.isOfficial} onChange={event => props.setSourceDraft(prev => ({ ...prev, isOfficial: event.target.checked }))} />
                    官方源
                  </label>
                  <button className="action-button primary">
                    <Plus className="h-4 w-4" />
                    添加源
                  </button>
                </form>

                <form onSubmit={props.onFollowUrl} className="drawer-card">
                  <h3>关注 B站 UP主</h3>
                  <p style={{ color: 'var(--text-soft)', fontSize: 13, margin: '0 0 10px' }}>
                    粘贴 B站空间链接，自动解析 UID
                  </p>
                  <div className="form-grid">
                    <input
                      value={props.followUrl}
                      onChange={event => props.setFollowUrl(event.target.value)}
                      placeholder="https://space.bilibili.com/652239032"
                      className="admin-input wide"
                    />
                    <input
                      value={props.followName}
                      onChange={event => props.setFollowName(event.target.value)}
                      placeholder="名称（可选，如 IGN中国）"
                      className="admin-input wide"
                    />
                  </div>
                  <button className="action-button primary">
                    <Plus className="h-4 w-4" />
                    添加关注
                  </button>
                </form>

                <div className="drawer-card">
                  <h3>B站 Cookie 配置</h3>
                  <p style={{ color: 'var(--text-soft)', fontSize: 13, margin: '0 0 10px' }}>
                    填入 B站 Cookie 可稳定采集视频源。获取方法：F12 → Application → Cookies → 复制 SESSDATA、bili_jct、DedeUserID
                  </p>
                  <textarea
                    value={props.bilibiliCookie}
                    onChange={event => props.setBilibiliCookie(event.target.value)}
                    placeholder="SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx"
                    className="admin-input wide"
                    rows={3}
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                  />
                  <button onClick={props.onSaveCookie} className="action-button primary" style={{ marginTop: 8 }}>
                    保存 Cookie
                  </button>
                </div>

                <div className="source-admin-list">
                  {props.sources.map(source => (
                    <div key={source.id} className="source-admin-row">
                      <div>
                        <p>{source.name}</p>
                        <span>{source.game} · {source.type} · {source._count?.feedItems || 0} 条</span>
                      </div>
                      <button onClick={() => props.onToggleSource(source.id)} className={source.enabled ? 'enabled' : ''}>
                        {source.enabled ? '启用' : '暂停'}
                      </button>
                      {source.lastError && <em>{source.lastError}</em>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
