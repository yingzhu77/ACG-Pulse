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
import type { ViewMode } from './constants';
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
  const [view, setView] = useState<ViewMode>('feed');
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

  const publicData = usePublicData(showToast);
  const admin = useAdmin(showToast, publicData.loadPublicData);
  const { favorites, toggleFavorite } = useFavorites();
  const hotSearch = useHotSearch(showToast);

  // Socket 订阅：仅 Feed 页激活时连接，避免非 Feed 用户白白建立 WebSocket
  useEffect(() => {
    if (view !== 'feed') return;
    const games = Object.keys(publicData.stats?.byGame || {});
    if (games.length > 0) subscribeToGames(games);
    const offItem = onNewItem((item) => {
      showToast('success', `新情报：${item.title.slice(0, 24)}`);
      void publicData.loadPublicData();
    });
    const offNotification = onNotification((n) => {
      showToast(n.importance === 'urgent' ? 'error' : 'success', n.title.slice(0, 36));
    });
    return () => { offItem(); offNotification(); };
  }, [view, publicData.stats?.byGame, publicData.loadPublicData, showToast]);

  const toggleSidebar = useCallback(() => setSidebarCollapsed(c => !c), []);
  const toggleAutoRefresh = useCallback(() => publicData.setAutoRefresh(a => !a), [publicData.setAutoRefresh]);
  const openAdmin = useCallback(() => admin.setAdminOpen(true), [admin.setAdminOpen]);
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
  const handleToggleFavorites = useCallback(() => {
    setShowFavorites(prev => {
      if (!prev) {
        publicData.setCategoryGroup('');
        publicData.setCategory('');
      }
      return !prev;
    });
  }, [publicData.setCategoryGroup, publicData.setCategory]);

  // Close mobile drawer on filter selection
  useEffect(() => {
    if (mobileDrawerOpen) {
      setMobileDrawerOpen(false);
    }
  }, [publicData.categoryGroup, publicData.category]);

  return (
    <main
      className={cn('game-pulse-shell min-h-dvh', theme === 'dark' ? 'theme-dark' : 'theme-light')}
      style={{ backgroundImage: `url(/game-pulse/bg-${theme}.png)` }}
    >
      <div className="scene-scrim" />
      <div className={`game-pulse-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <div className="left-column" ref={leftColumnRef}>
          <LogoBrand />
          <GameFilterPanel
          games={publicData.games}
          facets={publicData.facets}
          allFacets={publicData.allFacets}
          sourceFilter={publicData.sourceFilter}
          setSourceFilter={publicData.setSourceFilter}
          categoryGroup={publicData.categoryGroup}
          setCategoryGroup={publicData.setCategoryGroup}
          category={publicData.category}
          setCategory={publicData.setCategory}
          filters={publicData.filters}
          setFilters={publicData.setFiltersAndScroll}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          sources={publicData.sources}
          isMobile={isMobile}
          favorites={favorites}
          showFavorites={showFavorites}
          onToggleFavorites={handleToggleFavorites}
          showHotPanel={hotSearch.showHotPanel}
          onToggleHotPanel={hotSearch.toggleHotPanel}
          selectedHotTag={hotSearch.selectedTag}
          onSelectHotTag={hotSearch.selectTag}
        />
        </div>

        {!isMobile && sidebarCollapsed && (
          <button className="sidebar-expand-btn" onClick={toggleSidebar} aria-label="展开筛选" title="展开筛选">
            <Filter className="h-4 w-4" />
          </button>
        )}

        <TopBar
          theme={theme}
          setTheme={setTheme}
          loading={publicData.loading}
          view={view}
          onViewChange={setView}
          autoRefresh={publicData.autoRefresh}
          onToggleAutoRefresh={toggleAutoRefresh}
          onRefresh={publicData.loadPublicData}
          onOpenAdmin={openAdmin}
        />

        <section className="main-column">
          {view === 'feed' ? (
            <FeedPanel
              stories={publicData.stories}
              loading={publicData.loading}
              filters={publicData.filters}
              setFilters={publicData.setFilters}
              onRefresh={publicData.loadPublicData}
              pagination={publicData.pagination}
              page={publicData.page}
              setPage={publicData.setPage}
              favorites={favorites}
              showFavorites={showFavorites}
              onToggleFavorite={toggleFavorite}
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

        <SummaryColumn
          stats={publicData.stats}
          sources={publicData.sources}
          health={publicData.health}
          stories={publicData.stories}
          hotStories={publicData.summaryStories}
        />
      </div>

      {/* Mobile Filter FAB */}
      {isMobile && !mobileDrawerOpen && (
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
                setSourceFilter={publicData.setSourceFilter}
                categoryGroup={publicData.categoryGroup}
                setCategoryGroup={publicData.setCategoryGroup}
                category={publicData.category}
                setCategory={publicData.setCategory}
                filters={publicData.filters}
                setFilters={publicData.setFiltersAndScroll}
                collapsed={false}
                onToggleCollapse={closeMobileDrawer}
                sources={publicData.sources}
                isMobile={false}
                isInDrawer={true}
                favorites={favorites}
                showFavorites={showFavorites}
                onToggleFavorites={handleToggleFavorites}
                showHotPanel={hotSearch.showHotPanel}
                onToggleHotPanel={hotSearch.toggleHotPanel}
                selectedHotTag={hotSearch.selectedTag}
                onSelectHotTag={hotSearch.selectTag}
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
        onCreateSource={admin.handleCreateSource}
        onSeedDefaults={admin.handleSeedDefaults}
        onRunCheck={admin.handleRunCheck}
        onReanalyzeAll={admin.handleReanalyzeAll}
        analysisQueue={admin.analysisQueue}
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
