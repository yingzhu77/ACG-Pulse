import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { PublicStats, Source, Story, StoryFacets } from '../services/api';
import { publicApi } from '../services/api';
// Socket 订阅已移至 App.tsx，按需连接
import { summarizeHealth } from '../utils/stats';

type ShowToast = (type: 'success' | 'error', message: string) => void;

export function usePublicData(showToast: ShowToast) {
  const [stories, setStories] = useState<Story[]>([]);
  const [summaryStories, setSummaryStories] = useState<Story[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [facets, setFacets] = useState<StoryFacets>({ byGame: {}, byCategory: {}, byFollowCategory: {}, byImportance: {} });
  const [allFacets, setAllFacets] = useState<StoryFacets>({ byGame: {}, byCategory: {}, byFollowCategory: {}, byImportance: {} });
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [categoryGroup, setCategoryGroup] = useState<'game' | 'follow' | ''>('');
  const [category, setCategory] = useState('');
  const [filters, setFilters] = useState({ importance: '', q: '' });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Ref to track whether the next load should scroll to top after data arrives
  const scrollToTopRef = useRef(false);

  // Mark scroll-to-top before any state update that triggers loadPublicData
  const markScrollToTop = useCallback(() => { scrollToTopRef.current = true; }, []);

  const setPageAndScroll = useCallback((p: number) => {
    markScrollToTop();
    setPage(p);
  }, [markScrollToTop]);

  const setSourceFilterAndScroll = useCallback((v: string[]) => {
    markScrollToTop();
    setSourceFilter(v);
    setPage(1);
  }, [markScrollToTop]);

  const setCategoryGroupAndScroll = useCallback((v: 'game' | 'follow' | '') => {
    markScrollToTop();
    setCategoryGroup(v);
    setCategory('');
    setPage(1);
  }, [markScrollToTop]);

  const setCategoryAndScroll = useCallback((v: string) => {
    markScrollToTop();
    setCategory(v);
    setPage(1);
  }, [markScrollToTop]);

  const setFiltersAndScroll = useCallback((v: React.SetStateAction<{ importance: string; q: string }>) => {
    markScrollToTop();
    setFilters(v);
    setPage(1);
  }, [markScrollToTop]);

  const loadPublicData = useCallback(async () => {
    setLoading(true);
    try {
      const apiFilters: Record<string, string | string[] | number | undefined> = { limit: 20, page };
      if (sourceFilter.length > 0) {
        const uids = sourceFilter.filter(s => /^\d+$/.test(s));
        const games = sourceFilter.filter(s => !/^\d+$/.test(s));
        if (uids.length > 0 && games.length === 0) {
          apiFilters.sourceUid = uids;
          apiFilters.followGroup = 'follow';
        } else if (games.length > 0 && uids.length === 0) {
          apiFilters.game = games.length === 1 ? games[0] : games.join(',');
        }
      }
      if (category) apiFilters.category = category;
      if (categoryGroup) apiFilters.followGroup = categoryGroup === 'follow' ? 'follow' : 'game';
      if (filters.importance) apiFilters.importance = filters.importance;
      if (filters.q) apiFilters.q = filters.q;

      const summaryFilters: Record<string, string | number | boolean | undefined> = {
        limit: 60,
        page: 1,
        followGroup: 'game',
        includeFacets: false
      };
      const summaryGames = sourceFilter.filter(s => !/^\d+$/.test(s));
      if (summaryGames.length > 0) {
        summaryFilters.game = summaryGames.length === 1 ? summaryGames[0] : summaryGames.join(',');
      }

      const [storiesData, summaryStoriesData, statsData, sourcesData] = await Promise.all([
        publicApi.getStories(apiFilters),
        publicApi.getStories(summaryFilters),
        publicApi.getStats(),
        publicApi.getSources()
      ]);
      setStories(storiesData.data);
      setSummaryStories(summaryStoriesData.data);
      setFacets(storiesData.facets);
      setPagination(storiesData.pagination);
      setStats(statsData);
      if (sourceFilter.length === 0 && !categoryGroup && !category && !filters.importance) {
        setAllFacets(storiesData.facets);
      }
      setSources(sourcesData);

      // Scroll to top after data loads if requested
      if (scrollToTopRef.current) {
        scrollToTopRef.current = false;
        requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      }
    } catch (error) {
      scrollToTopRef.current = false;
      showToast('error', error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, categoryGroup, category, filters, page, showToast]);

  // Reset page to 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [sourceFilter, categoryGroup, category, filters.importance, filters.q]);

  useEffect(() => {
    loadPublicData();
  }, [loadPublicData]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void loadPublicData();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadPublicData]);

  const games = useMemo(() => Object.keys(allFacets.byGame || {}).filter(g => g.trim()).sort(), [allFacets]);
  const health = useMemo(() => summarizeHealth(sources), [sources]);
  const recentNotices = useMemo(() => stories.slice(0, 4), [stories]);

  return {
    stories,
    summaryStories,
    sources,
    stats,
    facets,
    allFacets,
    pagination,
    loading,
    autoRefresh,
    setAutoRefresh,
    sourceFilter,
    setSourceFilter: setSourceFilterAndScroll,
    categoryGroup,
    setCategoryGroup: setCategoryGroupAndScroll,
    category,
    setCategory: setCategoryAndScroll,
    filters,
    setFilters,
    setFiltersAndScroll,
    page,
    setPage: setPageAndScroll,
    loadPublicData,
    games,
    health,
    recentNotices
  } as const;
}
