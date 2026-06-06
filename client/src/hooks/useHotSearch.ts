import { useState, useCallback, useEffect } from 'react';
import { publicApi, type HotSearchItem } from '../services/api';

export type HotTag = 'game' | 'anime' | 'ai' | 'movie' | 'all';

export function useHotSearch() {
  const [hotItems, setHotItems] = useState<HotSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTag, setSelectedTag] = useState<HotTag>('all');
  const [showHotPanel, setShowHotPanel] = useState(false);

  const loadHotSearch = useCallback(async (tag?: HotTag) => {
    setLoading(true);
    try {
      const response = await publicApi.getHotSearch({
        tag: tag === 'all' ? undefined : tag,
        limit: 50
      });
      setHotItems(response.data);
    } catch (error) {
      console.error('Failed to load hot search:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectTag = useCallback((tag: HotTag) => {
    // Toggle: click same tag to deselect
    const newTag = selectedTag === tag ? 'all' : tag;
    setSelectedTag(newTag);
    loadHotSearch(newTag);
  }, [selectedTag, loadHotSearch]);

  const toggleHotPanel = useCallback(() => {
    setShowHotPanel(prev => !prev);
    if (!showHotPanel) {
      loadHotSearch(selectedTag);
    }
  }, [showHotPanel, selectedTag, loadHotSearch]);

  // Auto-refresh every 30 minutes
  useEffect(() => {
    if (!showHotPanel) return;
    const timer = setInterval(() => {
      loadHotSearch(selectedTag);
    }, 30 * 60 * 1000);
    return () => clearInterval(timer);
  }, [showHotPanel, selectedTag, loadHotSearch]);

  return {
    hotItems,
    loading,
    selectedTag,
    showHotPanel,
    selectTag,
    toggleHotPanel,
    loadHotSearch
  };
}
