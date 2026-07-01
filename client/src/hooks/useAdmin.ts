import { useState, useEffect, useCallback } from 'react';
import { adminApi, tokenStore, UnauthorizedError, type AnalysisQueueOverview, type OperationalMetrics, type Source, type SourcePreviewResponse } from '../services/api';

type ShowToast = (type: 'success' | 'error', message: string) => void;

export function useAdmin(showToast: ShowToast, loadPublicData: () => Promise<void>) {
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminToken, setAdminToken] = useState(tokenStore.get());
  const [password, setPassword] = useState('');
  const [adminSources, setAdminSources] = useState<Source[]>([]);
  const [analysisQueue, setAnalysisQueue] = useState<AnalysisQueueOverview | null>(null);
  const [operationalMetrics, setOperationalMetrics] = useState<OperationalMetrics | null>(null);
  const [operationalMetricsLoading, setOperationalMetricsLoading] = useState(false);
  const [operationalMetricsError, setOperationalMetricsError] = useState('');
  const [sourceDraft, setSourceDraft] = useState({
    name: '',
    game: '',
    type: 'bilibili_video',
    uid: '',
    url: '',
    route: '',
    isOfficial: false
  });
  const [sourcePreview, setSourcePreview] = useState<SourcePreviewResponse | null>(null);
  const [sourcePreviewLoading, setSourcePreviewLoading] = useState(false);
  const [sourcePreviewError, setSourcePreviewError] = useState('');
  const [followUrl, setFollowUrl] = useState('');
  const [followName, setFollowName] = useState('');
  const [bilibiliCookie, setBilibiliCookie] = useState('');

  const clearAdminSession = useCallback(() => {
    tokenStore.clear();
    setAdminToken(null);
    setAdminSources([]);
    setAnalysisQueue(null);
    setOperationalMetrics(null);
    setOperationalMetricsError('');
  }, []);

  const handleAdminError = useCallback((error: unknown, fallbackMessage: string) => {
    if (error instanceof UnauthorizedError) {
      clearAdminSession();
      showToast('error', '登录已过期，请重新输入管理员密码');
      return;
    }
    showToast('error', error instanceof Error ? error.message : fallbackMessage);
  }, [clearAdminSession, showToast]);

  const loadAdminSources = useCallback(async () => {
    if (!adminToken && !tokenStore.get()) return;
    try {
      setAdminSources(await adminApi.getSources());
      // 加载 B站 Cookie
      const settings = await adminApi.getSettings();
      if (settings.BILIBILI_COOKIE) {
        setBilibiliCookie(settings.BILIBILI_COOKIE);
      }
    } catch (error) {
      handleAdminError(error, '后台数据加载失败');
    }
  }, [adminToken, handleAdminError]);

  const loadAnalysisQueue = useCallback(async () => {
    if (!adminToken && !tokenStore.get()) return;
    try {
      setAnalysisQueue(await adminApi.getAnalysisQueue());
    } catch (error) {
      handleAdminError(error, '队列状态加载失败');
    }
  }, [adminToken, handleAdminError]);

  const loadOperationalMetrics = useCallback(async () => {
    if (!adminToken && !tokenStore.get()) return;
    setOperationalMetricsLoading(true);
    setOperationalMetricsError('');
    try {
      setOperationalMetrics(await adminApi.getOperationalMetrics());
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        handleAdminError(error, '运行状态加载失败');
      } else {
        setOperationalMetricsError(error instanceof Error ? error.message : '运行状态加载失败');
      }
    } finally {
      setOperationalMetricsLoading(false);
    }
  }, [adminToken, handleAdminError]);

  useEffect(() => {
    if (adminOpen) {
      void loadAdminSources();
      void loadAnalysisQueue();
      void loadOperationalMetrics();
    }
  }, [adminOpen, loadAdminSources, loadAnalysisQueue, loadOperationalMetrics]);

  useEffect(() => {
    if (!adminOpen || !adminToken) return;
    const timer = window.setInterval(() => void loadOperationalMetrics(), 30_000);
    return () => window.clearInterval(timer);
  }, [adminOpen, adminToken, loadOperationalMetrics]);

  const handleAdminLogin = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await adminApi.login(password);
      tokenStore.set(result.token);
      setAdminToken(result.token);
      setPassword('');
      showToast('success', '后台已解锁');
      await Promise.all([loadAdminSources(), loadAnalysisQueue(), loadOperationalMetrics()]);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '登录失败');
    }
  }, [password, showToast, loadAdminSources, loadAnalysisQueue, loadOperationalMetrics]);

  const handleSeedDefaults = useCallback(async () => {
    if (!adminToken) {
      setAdminOpen(true);
      return;
    }
    try {
      const result = await adminApi.seedDefaults();
      showToast('success', `已准备 ${result.count} 个默认源`);
      await Promise.all([loadAdminSources(), loadPublicData()]);
    } catch (error) {
      handleAdminError(error, '种子源失败');
    }
  }, [adminToken, handleAdminError, loadAdminSources, loadPublicData, showToast]);

  const handleRunCheck = useCallback(async () => {
    if (!adminToken) {
      setAdminOpen(true);
      return;
    }
    try {
      const result = await adminApi.runCheck();
      showToast('success', `检查完成：新增 ${result.newItems}，失败 ${result.failedSources}`);
      await Promise.all([loadAdminSources(), loadAnalysisQueue(), loadOperationalMetrics(), loadPublicData()]);
    } catch (error) {
      handleAdminError(error, '检查失败');
    }
  }, [adminToken, handleAdminError, loadAdminSources, loadAnalysisQueue, loadOperationalMetrics, loadPublicData, showToast]);

  const handleReanalyzeAll = useCallback(async () => {
    if (!adminToken) {
      setAdminOpen(true);
      return;
    }
    try {
      const result = await adminApi.reanalyzeAll(500);
      showToast('success', `已入队 ${result.total} 条重新分析任务`);
      await loadAnalysisQueue();
    } catch (error) {
      handleAdminError(error, '重新分类失败');
    }
  }, [adminToken, handleAdminError, loadAnalysisQueue, showToast]);

  const handleRetryAnalysisTask = useCallback(async (id: string) => {
    if (!adminToken) return;
    try {
      await adminApi.retryAnalysisTask(id);
      showToast('success', '分析任务已重新入队');
      await loadAnalysisQueue();
    } catch (error) {
      handleAdminError(error, '重试任务失败');
    }
  }, [adminToken, handleAdminError, loadAnalysisQueue, showToast]);

  const handleRetryFailedAnalysisTasks = useCallback(async () => {
    if (!adminToken) return;
    try {
      const result = await adminApi.retryFailedAnalysisTasks();
      showToast('success', `已重新入队 ${result.count} 个失败任务`);
      await loadAnalysisQueue();
    } catch (error) {
      handleAdminError(error, '批量重试失败');
    }
  }, [adminToken, handleAdminError, loadAnalysisQueue, showToast]);

  const handleCreateSource = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await adminApi.createSource({
        ...sourceDraft,
        url: sourceDraft.url || (sourceDraft.uid ? `https://space.bilibili.com/${sourceDraft.uid}` : ''),
        config: JSON.stringify({ itemKind: sourceDraft.isOfficial ? 'official_post' : 'creator_video' })
      });
      setSourceDraft({ name: '', game: '', type: 'bilibili_video', uid: '', url: '', route: '', isOfficial: false });
      setSourcePreview(null);
      setSourcePreviewError('');
      showToast('success', '数据源已添加');
      await loadAdminSources();
    } catch (error) {
      handleAdminError(error, '添加失败');
    }
  }, [sourceDraft, handleAdminError, loadAdminSources, showToast]);

  const handlePreviewSource = useCallback(async () => {
    if (!adminToken) {
      setAdminOpen(true);
      return;
    }
    setSourcePreviewLoading(true);
    setSourcePreviewError('');
    setSourcePreview(null);
    try {
      const preview = await adminApi.previewSource({
        ...sourceDraft,
        url: sourceDraft.url || (sourceDraft.uid ? `https://space.bilibili.com/${sourceDraft.uid}` : ''),
        config: JSON.stringify({ itemKind: sourceDraft.isOfficial ? 'official_post' : 'creator_video' }),
        limit: 5
      });
      setSourcePreview(preview);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        handleAdminError(error, '预览失败');
      } else {
        setSourcePreviewError(error instanceof Error ? error.message : '预览失败，请检查 URL、UID 或 RSSHub route 后重试');
      }
    } finally {
      setSourcePreviewLoading(false);
    }
  }, [adminToken, handleAdminError, sourceDraft]);

  const handleToggleSource = useCallback(async (id: string) => {
    try {
      await adminApi.toggleSource(id);
      await loadAdminSources();
    } catch (error) {
      handleAdminError(error, '切换源状态失败');
    }
  }, [handleAdminError, loadAdminSources]);

  const handleFollowUrl = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!adminToken) { setAdminOpen(true); return; }
    try {
      await adminApi.followUrl(followUrl, followName || undefined);
      setFollowUrl('');
      setFollowName('');
      showToast('success', '已添加关注 UP主');
      await Promise.all([loadAdminSources(), loadPublicData()]);
    } catch (error) {
      handleAdminError(error, '添加关注失败');
    }
  }, [adminToken, followUrl, followName, handleAdminError, loadAdminSources, loadPublicData, showToast]);

  const handleLogout = useCallback(() => {
    clearAdminSession();
  }, [clearAdminSession]);

  const handleSaveCookie = useCallback(async () => {
    if (!adminToken) return;
    try {
      await adminApi.updateSettings({ BILIBILI_COOKIE: bilibiliCookie });
      showToast('success', 'Cookie 已保存，重启服务后生效');
    } catch (error) {
      handleAdminError(error, '保存失败');
    }
  }, [adminToken, bilibiliCookie, handleAdminError, showToast]);

  return {
    adminOpen,
    setAdminOpen,
    adminToken,
    password,
    setPassword,
    adminSources,
    analysisQueue,
    operationalMetrics,
    operationalMetricsLoading,
    operationalMetricsError,
    loadOperationalMetrics,
    sourceDraft,
    setSourceDraft,
    sourcePreview,
    sourcePreviewLoading,
    sourcePreviewError,
    followUrl,
    setFollowUrl,
    followName,
    setFollowName,
    bilibiliCookie,
    setBilibiliCookie,
    handleAdminLogin,
    handleSeedDefaults,
    handleRunCheck,
    handleReanalyzeAll,
    handleRetryAnalysisTask,
    handleRetryFailedAnalysisTasks,
    handleCreateSource,
    handlePreviewSource,
    handleToggleSource,
    handleFollowUrl,
    handleLogout,
    handleSaveCookie
  } as const;
}
