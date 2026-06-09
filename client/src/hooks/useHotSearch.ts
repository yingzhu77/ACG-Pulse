import { useState, useCallback, useEffect, useRef } from 'react';
import { publicApi, type HotSearchItem } from '../services/api';

export type HotTag = 'game' | 'anime' | 'ai' | 'movie' | 'all';

type ShowToast = (type: 'success' | 'error', message: string) => void;

export function useHotSearch(showToast?: ShowToast) {
  const [hotItems, setHotItems] = useState<HotSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTag, setSelectedTag] = useState<HotTag>('all');
  const [showHotPanel, setShowHotPanel] = useState(false);

  const selectedTagRef = useRef(selectedTag);
  const showHotPanelRef = useRef(showHotPanel);
  selectedTagRef.current = selectedTag;
  showHotPanelRef.current = showHotPanel;

  const loadHotSearch = useCallback(async (tag?: HotTag) => {
    setLoading(true);
    try {
      const response = await publicApi.getHotSearch({
        tag: tag === 'all' ? undefined : tag,
        limit: 50
      });
      setHotItems(response.data);
    } catch (error) {
      showToast?.('error', '热搜加载失败');
      console.error('Failed to load hot search:', error);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const selectTag = useCallback((tag: HotTag) => {
    const newTag = selectedTagRef.current === tag ? 'all' : tag;
    setSelectedTag(newTag);
    loadHotSearch(newTag);
  }, [loadHotSearch]);

  const toggleHotPanel = useCallback(() => {
    const opening = !showHotPanelRef.current;
    setShowHotPanel(opening);
    if (opening) {
      loadHotSearch(selectedTagRef.current);
    }
  }, [loadHotSearch]);

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
