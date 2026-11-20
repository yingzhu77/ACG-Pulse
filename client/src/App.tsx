import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, CircleAlert, Filter } from 'lucide-react';
import { cn } from './lib/utils';
import { useToast } from './hooks/useToast';
import { useTheme } from './hooks/useTheme';
import { usePublicData } from './hooks/usePublicData';
import { useAdmin } from './hooks/useAdmin';
import { useFavorites } from './hooks/useFavorites';
import { useHotSearch } from './hooks/useHotSearch';
import { useFeaturedGame } from './hooks/useFeaturedGame';
import { useReadingHistory } from './hooks/useReadingHistory';
import { readingRoute, viewPaths } from './lib/readingNavigation';
import type { ViewMode } from './constants';
import { EditionsPanel, EventPanel, FeaturedPanel } from './components/ReadingPanels';
import { subscribeToGames, onNewItem, onNotification } from './services/socket';
import { GameFilterPanel } from './components/GameFilterPanel';
import { LogoBrand } from './components/LogoBrand';
import { TopBar } from './components/TopBar';
import { FeedPanel } from './components/FeedPanel';
import { SummaryColumn } from './components/SummaryColumn';

const InsightsPage = lazy(() => import('./components/InsightsPage').then(m => ({ default: m.InsightsPage })));
const CommunityPanel = lazy(() => import('./components/CommunityPanel').then(m => ({ default: m.CommunityPanel })));
const AdminDrawer = lazy(() => import('./components/AdminDrawer').then(m => ({ default: m.AdminDrawer })));

function App() {
  const { toast, showToast } = useToast();
  const { theme, setTheme } = useTheme();
  const { location, mainRef, navigate, goBackToList } = useReadingHistory();
  const route = readingRoute(location.path);
  const view = route.view;
  const readingView = view === 'today' || view === 'event' || view === 'daily';
  const [readingRefresh, setReadingRefresh] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const leftColumnRef = useRef<HTMLDivElement | null>(null);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const publicData = usePublicData(showToast, !readingView);
  const featured = useFeaturedGame(publicData.configuredGames);
  const admin = useAdmin(showToast, publicData.loadPublicData);
  const { favorites, toggleFavorite, resolveAliases } = useFavorites();
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
    if (!publicData.autoRefresh || !['today', 'event', 'daily'].includes(view)) return;
    const timer = window.setInterval(() => setReadingRefresh(n => n + 1), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [publicData.autoRefresh, view]);

  useEffect(() => {
    resolveAliases(publicData.stories);
  }, [publicData.stories, resolveAliases]);

  const openFollowing = () => {
    setShowFavorites(false);
    if (hotSearch.showHotPanel) hotSearch.toggleHotPanel();
    publicData.setSourceFilter([]);
    setCategoryGroup('follow');
    publicData.setFiltersAndScroll({ importance: '', q: '' });
    navigate('/all');
    setMobileDrawerOpen(false);
  };
  const changeView = (next: ViewMode) => {
    if (next === 'feed') {
      setShowFavorites(false);
      if (hotSearch.showHotPanel) hotSearch.toggleHotPanel();
      if (categoryGroup) setCategoryGroup('');
      if (publicData.sourceFilter.length) publicData.setSourceFilter([]);
      if (publicData.filters.importance || publicData.filters.q) publicData.setFiltersAndScroll({ importance: '', q: '' });
    }
    navigate(viewPaths[next]);
  };
  const switchToFilter = () => {
    setShowFavorites(false);
    if (hotSearch.showHotPanel) hotSearch.toggleHotPanel();
    navigate('/all');
    setMobileDrawerOpen(false);
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
    setShowFavorites(false);
    navigate('/all');
    hotSearch.toggleHotPanel();
    setMobileDrawerOpen(false);
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

  const toggleSidebar = useCallback(() => setSidebarCollapsed(c => !c), []);
  const toggleAutoRefresh = useCallback(() => setAutoRefresh(a => !a), [setAutoRefresh]);
  const openAdmin = useCallback(() => setAdminOpen(true), [setAdminOpen]);
  const closeMobileDrawer = useCallback(() => setMobileDrawerOpen(false), []);
  const openMobileDrawer = useCallback(() => setMobileDrawerOpen(true), []);
  useEffect(() => {
    const el = leftColumnRef.current;
    if (!el) return;

    const handleWheel = (event: WheelEvent) => {
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll <= 0) return;

      const nextScroll = Math.max(0, Math.min(maxScroll, el.scrollTop + event.deltaY));
      if (nextScroll === el.scrollTop) return;

      event.preventDefault();
      event.stopPropagation();
      el.scrollTop = nextScroll;
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);
  const handleToggleFavorites = () => {
    if (hotSearch.showHotPanel) hotSearch.toggleHotPanel();
    setShowFavorites(previous => !previous);
    navigate('/all');
    setMobileDrawerOpen(false);
  };

  return (
    <main
      className={cn('game-pulse-shell min-h-dvh', `theme-${theme}`)}
    >
      <div
        className="scene-background"
        style={{ backgroundImage: `url(/game-pulse/bg-${theme}.png)` }}
        aria-hidden="true"
      />
      <div className="scene-scrim" />
      <div className={cn('game-pulse-layout', readingView && 'reading-layout', !readingView && sidebarCollapsed && 'sidebar-collapsed')}>
        <div className="left-column" ref={leftColumnRef}>
          <LogoBrand />
          {!readingView && <GameFilterPanel
          games={publicData.games}
          facets={publicData.facets}
          allFacets={publicData.allFacets}
          sourceFilter={publicData.sourceFilter}
          setSourceFilter={filterSource}
          categoryGroup={publicData.categoryGroup}
          setCategoryGroup={filterGroup}
          category={publicData.category}
          setCategory={filterCategory}
          filters={publicData.filters}
          setFilters={changeFilters}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          sources={publicData.sources}
          isMobile={isMobile}
          favorites={favorites}
          showFavorites={showFavorites}
          onToggleFavorites={handleToggleFavorites}
          showHotPanel={hotSearch.showHotPanel}
          onToggleHotPanel={handleToggleHotPanel}
          selectedHotTag={hotSearch.selectedTag}
          onSelectHotTag={tag => { hotSearch.selectTag(tag); setMobileDrawerOpen(false); }}
        />}
        </div>

        {!readingView && !isMobile && sidebarCollapsed && (
          <button className="sidebar-expand-btn" onClick={toggleSidebar} aria-label="展开筛选" title="展开筛选">
            <Filter className="h-4 w-4" />
          </button>
        )}

        <TopBar
          theme={theme}
          setTheme={setTheme}
          loading={publicData.loading}
          view={activeView}
          onViewChange={changeView}
          autoRefresh={publicData.autoRefresh}
          onToggleAutoRefresh={toggleAutoRefresh}
          onRefresh={refresh}
          onOpenAdmin={openAdmin}
        />

        <section className="main-column" ref={mainRef}>
          {route.view === 'today' ? (
            <FeaturedPanel games={featured.games} game={featured.game} onGameChange={featured.chooseGame}
              refresh={readingRefresh} navigate={navigate} onOpenFollowing={openFollowing} onOpenAll={() => changeView('feed')} />
          ) : route.view === 'daily' ? (
            <EditionsPanel date={route.date} refresh={readingRefresh} navigate={navigate} />
          ) : route.view === 'event' ? (
            <EventPanel key={route.id} id={route.id} back={referencedList} refresh={readingRefresh} navigate={goBackToList}
              favorites={favorites} onToggleFavorite={toggleFavorite} onResolveAliases={resolveAliases} />
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
              showFavorites={showFavorites}
              onToggleFavorite={toggleFavorite}
              onResolveAliases={resolveAliases}
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
        </section>

        {!readingView && <SummaryColumn
          stats={publicData.stats}
          sources={publicData.sources}
          health={publicData.health}
          stories={publicData.stories}
          hotStories={publicData.summaryStories}
          navigate={navigate}
        />}
      </div>

      {/* Mobile Filter FAB */}
      {isMobile && view === 'feed' && !mobileDrawerOpen && !admin.adminOpen && (
        <button
          className="mobile-filter-fab"
          onClick={openMobileDrawer}
          aria-label="打开筛选"
        >
          <Filter className="h-5 w-5" />
        </button>
      )}

      {/* Mobile Drawer Overlay */}
      <AnimatePresence>
        {isMobile && mobileDrawerOpen && (
          <>
            <motion.div
              className="mobile-drawer-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeMobileDrawer}
            />
            <motion.div
              className="mobile-drawer"
              initial={{ x: -300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -300, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            >
              <GameFilterPanel
                games={publicData.games}
                facets={publicData.facets}
                allFacets={publicData.allFacets}
                sourceFilter={publicData.sourceFilter}
                setSourceFilter={filterSource}
                categoryGroup={publicData.categoryGroup}
                setCategoryGroup={filterGroup}
                category={publicData.category}
                setCategory={filterCategory}
                filters={publicData.filters}
                setFilters={changeFilters}
                collapsed={false}
                onToggleCollapse={closeMobileDrawer}
                sources={publicData.sources}
                isMobile={false}
                isInDrawer={true}
                favorites={favorites}
                showFavorites={showFavorites}
                onToggleFavorites={handleToggleFavorites}
                showHotPanel={hotSearch.showHotPanel}
                onToggleHotPanel={handleToggleHotPanel}
                selectedHotTag={hotSearch.selectedTag}
                onSelectHotTag={tag => { hotSearch.selectTag(tag); setMobileDrawerOpen(false); }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
    </main>
  );
}

export default App;
