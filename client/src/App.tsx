import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, CircleAlert, Filter } from 'lucide-react';
import { cn } from './lib/utils';
import { useToast } from './hooks/useToast';
import { useTheme } from './hooks/useTheme';
import { usePublicData } from './hooks/usePublicData';
import { useAdmin } from './hooks/useAdmin';
import { useFavorites } from './hooks/useFavorites';
import { useHotSearch } from './hooks/useHotSearch';
import { GameFilterPanel } from './components/GameFilterPanel';
import { TopBar } from './components/TopBar';
import { FeedPanel } from './components/FeedPanel';
import { InsightsPage } from './components/InsightsPage';
import { SummaryColumn } from './components/SummaryColumn';
import { AdminDrawer } from './components/AdminDrawer';

function App() {
  const { toast, showToast } = useToast();
  const { theme, setTheme } = useTheme();
  const [view, setView] = useState<'feed' | 'insights'>('feed');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);

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
  const hotSearch = useHotSearch();

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
          onToggleCollapse={() => setSidebarCollapsed(c => !c)}
          sources={publicData.sources}
          isMobile={isMobile}
          favorites={favorites}
          showFavorites={showFavorites}
          showHotPanel={hotSearch.showHotPanel}
          onToggleHotPanel={hotSearch.toggleHotPanel}
          selectedHotTag={hotSearch.selectedTag}
          onSelectHotTag={hotSearch.selectTag}
          setShowFavorites={setShowFavorites}
        />

        <TopBar
          theme={theme}
          setTheme={setTheme}
          loading={publicData.loading}
          view={view}
          onViewChange={setView}
          autoRefresh={publicData.autoRefresh}
          onToggleAutoRefresh={() => publicData.setAutoRefresh(a => !a)}
          onRefresh={publicData.loadPublicData}
          onOpenAdmin={() => admin.setAdminOpen(true)}
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
          ) : (
            <InsightsPage
              gameCategoryCounts={publicData.stats?.byCategory || {}}
              followCategoryCounts={publicData.stats?.byFollowCategory || {}}
              importanceCounts={publicData.stats?.byImportance || {}}
              hourlyTrend={publicData.stats?.hourlyTrend || []}
            />
          )}
        </section>

        <SummaryColumn stats={publicData.stats} sources={publicData.sources} health={publicData.health} stories={publicData.stories} />
      </div>

      {/* Mobile Filter FAB */}
      {isMobile && !mobileDrawerOpen && (
        <button
          className="mobile-filter-fab"
          onClick={() => setMobileDrawerOpen(true)}
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
              onClick={() => setMobileDrawerOpen(false)}
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
                onToggleCollapse={() => setMobileDrawerOpen(false)}
                sources={publicData.sources}
                isMobile={false}
                isInDrawer={true}
                favorites={favorites}
                showFavorites={showFavorites}
                showHotPanel={hotSearch.showHotPanel}
                onToggleHotPanel={hotSearch.toggleHotPanel}
                selectedHotTag={hotSearch.selectedTag}
                onSelectHotTag={hotSearch.selectTag}
                setShowFavorites={setShowFavorites}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
        reanalyzeProgress={admin.reanalyzeProgress}
        onToggleSource={admin.handleToggleSource}
        followUrl={admin.followUrl}
        setFollowUrl={admin.setFollowUrl}
        followName={admin.followName}
        setFollowName={admin.setFollowName}
        onFollowUrl={admin.handleFollowUrl}
      />

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
