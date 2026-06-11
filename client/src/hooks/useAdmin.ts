import { useState, useEffect, useCallback } from 'react';
import { adminApi, tokenStore, type AnalysisQueueOverview, type Source } from '../services/api';
import type { ReanalyzeProgress } from '../services/socket';
import { onReanalyzeProgress, onReanalyzeDone, onReanalyzeError } from '../services/socket';

type ShowToast = (type: 'success' | 'error', message: string) => void;

export function useAdmin(showToast: ShowToast, loadPublicData: () => Promise<void>) {
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminToken, setAdminToken] = useState(tokenStore.get());
  const [password, setPassword] = useState('');
  const [adminSources, setAdminSources] = useState<Source[]>([]);
  const [analysisQueue, setAnalysisQueue] = useState<AnalysisQueueOverview | null>(null);
  const [reanalyzeProgress, setReanalyzeProgress] = useState<ReanalyzeProgress | null>(null);
  const [sourceDraft, setSourceDraft] = useState({
    name: '',
    game: '',
    type: 'bilibili_video',
    uid: '',
    url: '',
    route: '',
    isOfficial: false
  });
  const [followUrl, setFollowUrl] = useState('');
  const [followName, setFollowName] = useState('');
  const [bilibiliCookie, setBilibiliCookie] = useState('');

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
      showToast('error', error instanceof Error ? error.message : '后台数据加载失败');
    }
  }, [adminToken, showToast]);

  const loadAnalysisQueue = useCallback(async () => {
    if (!adminToken && !tokenStore.get()) return;
    try {
      setAnalysisQueue(await adminApi.getAnalysisQueue());
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '队列状态加载失败');
    }
  }, [adminToken, showToast]);

  useEffect(() => {
    if (adminOpen) {
      void loadAdminSources();
      void loadAnalysisQueue();
    }
  }, [adminOpen, loadAdminSources, loadAnalysisQueue]);

  // Reanalyze WebSocket progress tracking
  useEffect(() => {
    if (!adminToken) return;
    const offProgress = onReanalyzeProgress((progress) => {
      setReanalyzeProgress(progress);
    });
    const offDone = onReanalyzeDone(() => {
      setReanalyzeProgress(null);
    });
    const offError = onReanalyzeError(() => {
      setReanalyzeProgress(null);
    });
    return () => {
      offProgress();
      offDone();
      offError();
    };
  }, [adminToken]);

  const handleAdminLogin = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await adminApi.login(password);
      tokenStore.set(result.token);
      setAdminToken(result.token);
      setPassword('');
      showToast('success', '后台已解锁');
      await Promise.all([loadAdminSources(), loadAnalysisQueue()]);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '登录失败');
    }
  }, [password, showToast, loadAdminSources]);

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
      showToast('error', error instanceof Error ? error.message : '种子源失败');
    }
  }, [adminToken, showToast, loadAdminSources, loadPublicData]);

  const handleRunCheck = useCallback(async () => {
    if (!adminToken) {
      setAdminOpen(true);
      return;
    }
    try {
      const result = await adminApi.runCheck();
      showToast('success', `检查完成：新增 ${result.newItems}，失败 ${result.failedSources}`);
      await Promise.all([loadAdminSources(), loadAnalysisQueue(), loadPublicData()]);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '检查失败');
    }
  }, [adminToken, showToast, loadAdminSources, loadAnalysisQueue, loadPublicData]);

  const handleReanalyzeAll = useCallback(async () => {
    if (!adminToken) {
      setAdminOpen(true);
      return;
    }
    try {
      await adminApi.reanalyzeAll(500);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '重新分类失败');
    }
  }, [adminToken, showToast]);

  const handleRetryAnalysisTask = useCallback(async (id: string) => {
    if (!adminToken) return;
    try {
      await adminApi.retryAnalysisTask(id);
      showToast('success', '分析任务已重新入队');
      await loadAnalysisQueue();
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '重试任务失败');
    }
  }, [adminToken, showToast, loadAnalysisQueue]);

  const handleRetryFailedAnalysisTasks = useCallback(async () => {
    if (!adminToken) return;
    try {
      const result = await adminApi.retryFailedAnalysisTasks();
      showToast('success', `已重新入队 ${result.count} 个失败任务`);
      await loadAnalysisQueue();
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '批量重试失败');
    }
  }, [adminToken, showToast, loadAnalysisQueue]);

  const handleCreateSource = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await adminApi.createSource({
        ...sourceDraft,
        url: sourceDraft.url || (sourceDraft.uid ? `https://space.bilibili.com/${sourceDraft.uid}` : ''),
        config: JSON.stringify({ itemKind: sourceDraft.isOfficial ? 'official_post' : 'creator_video' })
      });
      setSourceDraft({ name: '', game: '', type: 'bilibili_video', uid: '', url: '', route: '', isOfficial: false });
      showToast('success', '数据源已添加');
      await loadAdminSources();
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '添加失败');
    }
  }, [sourceDraft, showToast, loadAdminSources]);

  const handleToggleSource = useCallback(async (id: string) => {
    try {
      await adminApi.toggleSource(id);
      await loadAdminSources();
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '切换源状态失败');
    }
  }, [loadAdminSources, showToast]);

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
      showToast('error', error instanceof Error ? error.message : '添加关注失败');
    }
  }, [adminToken, followUrl, followName, showToast, loadAdminSources, loadPublicData]);

  const handleLogout = useCallback(() => {
    tokenStore.clear();
    setAdminToken(null);
    setAdminSources([]);
    setAnalysisQueue(null);
  }, []);

  const handleSaveCookie = useCallback(async () => {
    if (!adminToken) return;
    try {
      await adminApi.updateSettings({ BILIBILI_COOKIE: bilibiliCookie });
      showToast('success', 'Cookie 已保存，重启服务后生效');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '保存失败');
    }
  }, [adminToken, bilibiliCookie, showToast]);

  return {
    adminOpen,
    setAdminOpen,
    adminToken,
    password,
    setPassword,
    adminSources,
    analysisQueue,
    reanalyzeProgress,
    sourceDraft,
    setSourceDraft,
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
    handleToggleSource,
    handleFollowUrl,
    handleLogout,
    handleSaveCookie
  } as const;
}
