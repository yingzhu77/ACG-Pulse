import { useState, useEffect, useCallback, useRef, useSyncExternalStore, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ChevronDown, CircleAlert, Filter } from 'lucide-react';
import { cn } from './lib/utils';
import { useToast } from './hooks/useToast';
import { useTheme } from './hooks/useTheme';
import { usePublicData } from './hooks/usePublicData';
import { useAdmin } from './hooks/useAdmin';
import { useFavorites } from './hooks/useFavorites';
import { useHotSearch } from './hooks/useHotSearch';
import { useFeaturedGame } from './hooks/useFeaturedGame';
import { usePageTitle, useReadingHistory } from './hooks/useReadingHistory';
import { readingRoute, viewPaths, viewTitles } from './lib/readingNavigation';
import type { ViewMode } from './constants';
import { EditionsPanel, EventPanel, FeaturedPanel } from './components/ReadingPanels';
import { subscribeToGames, onNewItem, onNotification } from './services/socket';
import { GameFilterPanel } from './components/GameFilterPanel';
import { Sidebar } from './components/Sidebar';
import './sidebar.css';
import { TopBar } from './components/TopBar';
import { FavoritesPanel, FeedPanel } from './components/FeedPanel';
import { SummaryColumn } from './components/SummaryColumn';

const InsightsPage = lazy(() => import('./components/InsightsPage').then(m => ({ default: m.InsightsPage })));
const CommunityPanel = lazy(() => import('./components/CommunityPanel').then(m => ({ default: m.CommunityPanel })));
const AdminDrawer = lazy(() => import('./components/AdminDrawer').then(m => ({ default: m.AdminDrawer })));

const narrowScreen = window.matchMedia('(max-width: 768px)');
function subscribeToViewport(onChange: () => void) {
  narrowScreen.addEventListener('change', onChange);
  return () => narrowScreen.removeEventListener('change', onChange);
}
const isNarrowScreen = () => narrowScreen.matches;

function App() {
  const { toast, showToast } = useToast();
  const { theme, setTheme } = useTheme();
  const { location, mainRef, navigate, goBackToList } = useReadingHistory();
  const route = readingRoute(location.path);
  const view = route.view;
  // Event and edition panels supply their titles from the same public data shown on screen.
  usePageTitle(view === 'event' || view === 'daily' ? undefined : viewTitles[view]);
  const readingView = view === 'today' || view === 'event' || view === 'daily' || view === 'favorites';
  const [readingRefresh, setReadingRefresh] = useState(0);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const isMobile = useSyncExternalStore(subscribeToViewport, isNarrowScreen);
  const closeDrawer = useCallback(() => drawerRef.current?.close(), []);
  useEffect(() => {
    window.addEventListener('popstate', closeDrawer);
    return () => window.removeEventListener('popstate', closeDrawer);
  }, [closeDrawer]);

  const publicData = usePublicData(showToast, !readingView);
  const featured = useFeaturedGame(publicData.configuredGames);
  const admin = useAdmin(showToast, publicData.loadPublicData);
  const bookmarks = useFavorites();
  const { favorites, toggleFavorite, resolveAliases } = bookmarks;
  const hotSearch = useHotSearch(showToast);
  const {
    stats,
    loadPublicData,
    setAutoRefresh,
    setCategoryGroup,
    setCategory,
    categoryGroup
  } = publicData;
  const { setAdminOpen } = admin;

  const refresh = useCallback(() => {
    void loadPublicData();
    setReadingRefresh(n => n + 1);
  }, [loadPublicData]);
  useEffect(() => {
    if (!publicData.autoRefresh || !readingView) return;
    const timer = window.setInterval(() => setReadingRefresh(n => n + 1), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [publicData.autoRefresh, readingView]);

  useEffect(() => {
    resolveAliases(publicData.stories);
  }, [publicData.stories, resolveAliases]);

  const openFollowing = () => {
    if (hotSearch.showHotPanel) hotSearch.toggleHotPanel();
    publicData.setSourceFilter([]);
    setCategoryGroup('follow');
    publicData.setFiltersAndScroll({ importance: '', q: '' });
    navigate('/all');
    closeDrawer();
  };
  const changeView = (next: ViewMode) => {
    if (next === 'feed') {
      if (hotSearch.showHotPanel) hotSearch.toggleHotPanel();
      if (categoryGroup) setCategoryGroup('');
      if (publicData.sourceFilter.length) publicData.setSourceFilter([]);
      if (publicData.filters.importance || publicData.filters.q) publicData.setFiltersAndScroll({ importance: '', q: '' });
    }
    navigate(viewPaths[next]);
    if (drawerRef.current?.open) {
      closeDrawer();
      mainRef.current?.focus({ preventScroll: true });
    }
  };
  const switchToFilter = () => {
    if (hotSearch.showHotPanel) hotSearch.toggleHotPanel();
    navigate('/all');
    closeDrawer();
  };
  const filterSource = (value: string[]) => {
    switchToFilter();
    if (value.length && ((categoryGroup === 'game' && value.every(item => /^\d+$/.test(item)))
      || (categoryGroup === 'follow' && value.every(item => !/^\d+$/.test(item))))) setCategoryGroup('');
    publicData.setSourceFilter(value);
  };
  const filterGroup = (value: '' | 'game' | 'follow') => {
    switchToFilter();
    if (value && publicData.sourceFilter.some(item => /^\d+$/.test(item) !== (value === 'follow'))) {
      publicData.setSourceFilter([]);
    }
    setCategoryGroup(value);
  };
  const filterCategory = (value: string) => { switchToFilter(); setCategory(value); };
  const changeFilters = (value: React.SetStateAction<{ importance: string; q: string }>) => {
    switchToFilter();
    publicData.setFiltersAndScroll(value);
  };
  const handleToggleHotPanel = () => {
    navigate('/all');
    hotSearch.toggleHotPanel();
    closeDrawer();
  };
  const previousView = location.back ? readingRoute(location.back).view : 'feed';
  const activeView = view === 'event' ? previousView === 'event' ? 'feed' : previousView : view;
  const referencedList = location.back && previousView !== 'event' ? location.back : undefined;

  // Socket 订阅：仅 Feed 页激活时连接，避免非 Feed 用户白白建立 WebSocket
  useEffect(() => {
    if (view !== 'feed') return;
    const games = Object.keys(stats?.byGame || {});
    if (games.length > 0) subscribeToGames(games);
    const offItem = onNewItem((item) => {
      showToast('success', `新情报：${item.title.slice(0, 24)}`);
      void loadPublicData();
    });
    const offNotification = onNotification((n) => {
      showToast(n.importance === 'urgent' ? 'error' : 'success', n.title.slice(0, 36));
    });
    return () => { offItem(); offNotification(); };
  }, [view, stats?.byGame, loadPublicData, showToast]);

  const toggleAutoRefresh = useCallback(() => setAutoRefresh(a => !a), [setAutoRefresh]);
  const openAdmin = () => { closeDrawer(); setAdminOpen(true); };
  const sidebar = (
    <Sidebar view={activeView} onViewChange={changeView} theme={theme} setTheme={setTheme}
      onOpenAdmin={openAdmin} onClose={isMobile ? closeDrawer : undefined}>
      {!readingView && <details className="workspace-filters">
        <summary><Filter size={17} aria-hidden="true" />动态筛选<ChevronDown size={15} aria-hidden="true" /></summary>
        <GameFilterPanel games={publicData.games} facets={publicData.facets} allFacets={publicData.allFacets}
          sourceFilter={publicData.sourceFilter} setSourceFilter={filterSource}
          categoryGroup={publicData.categoryGroup} setCategoryGroup={filterGroup}
          category={publicData.category} setCategory={filterCategory}
          filters={publicData.filters} setFilters={changeFilters} sources={publicData.sources}
          showHotPanel={hotSearch.showHotPanel} onToggleHotPanel={handleToggleHotPanel}
          selectedHotTag={hotSearch.selectedTag} onSelectHotTag={tag => { hotSearch.selectTag(tag); closeDrawer(); }} />
      </details>}
    </Sidebar>
  );

  return (
    <div className={cn('game-pulse-shell min-h-dvh', `theme-${theme}`)}>
      <a className="workspace-skip" href="#workspace-main">跳到正文</a>
      <div className="workspace-layout">
        {isMobile ? (
          <dialog className="workspace-drawer" ref={drawerRef} id="navigation-drawer" aria-label="导航菜单"
            onClick={event => { if (event.target === event.currentTarget) closeDrawer(); }}>
            {sidebar}
          </dialog>
        ) : <aside className="workspace-sidebar">{sidebar}</aside>}
        <div className="workspace-content">
          <TopBar loading={publicData.loading} autoRefresh={publicData.autoRefresh}
            onToggleAutoRefresh={toggleAutoRefresh} onRefresh={refresh} onOpenDaily={() => changeView('daily')}
            onOpenNavigation={isMobile ? () => drawerRef.current?.showModal() : undefined} />
          <main id="workspace-main" className="main-column" ref={mainRef} tabIndex={-1}>
            {route.view === 'today' ? (
              <FeaturedPanel games={featured.games} game={featured.game} onGameChange={featured.chooseGame}
                refresh={readingRefresh} navigate={navigate} onOpenFollowing={openFollowing} bookmarks={bookmarks} onOpenSettings={openAdmin} />
            ) : route.view === 'daily' ? (
              <EditionsPanel date={route.date} refresh={readingRefresh} navigate={navigate} bookmarks={bookmarks} />
            ) : route.view === 'event' ? (
              <EventPanel key={route.id} id={route.id} back={referencedList} refresh={readingRefresh} navigate={goBackToList}
                favorites={favorites} onToggleFavorite={toggleFavorite} onResolveAliases={resolveAliases} />
            ) : view === 'favorites' ? (
              <FavoritesPanel favorites={favorites} onToggleFavorite={toggleFavorite} onResolveAliases={resolveAliases}
                navigate={navigate} refresh={readingRefresh} />
            ) : view === 'feed' ? (
              <FeedPanel
                stories={publicData.stories}
                loading={publicData.loading}
                filters={publicData.filters}
                setFilters={publicData.setFiltersAndScroll}
                onRefresh={refresh}
                pagination={publicData.pagination}
                page={publicData.page}
                setPage={publicData.setPage}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                navigate={navigate}
                showHotPanel={hotSearch.showHotPanel}
                hotItems={hotSearch.hotItems}
                hotLoading={hotSearch.loading}
                selectedHotTag={hotSearch.selectedTag}
              />
            ) : view === 'insights' ? (
              <Suspense fallback={<div className="ci-empty">加载中…</div>}>
                <InsightsPage
                  gameCategoryCounts={publicData.stats?.byCategory || {}}
                  followCategoryCounts={publicData.stats?.byFollowCategory || {}}
                  importanceCounts={publicData.stats?.byImportance || {}}
                  hourlyTrend={publicData.stats?.hourlyTrend || []}
                />
              </Suspense>
            ) : (
              <Suspense fallback={<div className="ci-empty">加载中…</div>}>
                <CommunityPanel />
              </Suspense>
            )}
          </main>
          {view === 'feed' && <details className="workspace-summary">
            <summary>运行概览</summary>
            <SummaryColumn stats={publicData.stats} sources={publicData.sources} health={publicData.health}
              stories={publicData.stories} hotStories={publicData.summaryStories} navigate={navigate} />
          </details>}
        </div>
      </div>

      <Suspense fallback={null}>
      <AdminDrawer
        open={admin.adminOpen}
        onClose={() => admin.setAdminOpen(false)}
        token={admin.adminToken}
        password={admin.password}
        setPassword={admin.setPassword}
        onLogin={admin.handleAdminLogin}
        onLogout={admin.handleLogout}
        sources={admin.adminSources}
        sourceDraft={admin.sourceDraft}
        setSourceDraft={admin.setSourceDraft}
        sourcePreview={admin.sourcePreview}
        sourcePreviewLoading={admin.sourcePreviewLoading}
        sourcePreviewError={admin.sourcePreviewError}
        onCreateSource={admin.handleCreateSource}
        onPreviewSource={admin.handlePreviewSource}
        onSeedDefaults={admin.handleSeedDefaults}
        onRunCheck={admin.handleRunCheck}
        onReanalyzeAll={admin.handleReanalyzeAll}
        analysisQueue={admin.analysisQueue}
        operationalMetrics={admin.operationalMetrics}
        operationalMetricsLoading={admin.operationalMetricsLoading}
        operationalMetricsError={admin.operationalMetricsError}
        onRefreshOperationalMetrics={admin.loadOperationalMetrics}
        onRetryAnalysisTask={admin.handleRetryAnalysisTask}
        onRetryFailedAnalysisTasks={admin.handleRetryFailedAnalysisTasks}
        onToggleSource={admin.handleToggleSource}
        followUrl={admin.followUrl}
        setFollowUrl={admin.setFollowUrl}
        followName={admin.followName}
        setFollowName={admin.setFollowName}
        onFollowUrl={admin.handleFollowUrl}
        bilibiliCookie={admin.bilibiliCookie}
        setBilibiliCookie={admin.setBilibiliCookie}
        onSaveCookie={admin.handleSaveCookie}
      />
      </Suspense>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className={cn('pulse-toast', toast.type === 'success' ? 'toast-success' : 'toast-error')}
            role="status"
            aria-live="polite"
          >
            {toast.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
