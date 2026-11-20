import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'game_pulse_favorites';

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const values: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(values) ? [...new Set(values.filter((value): value is string => typeof value === 'string'))] : [];
  } catch {
    return [];
  }
}

function saveFavorites(ids: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* Keep the current session usable. */ }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);

  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  }, []);

  const resolveAliases = useCallback((stories: { id: string; legacyIds?: string[] }[]) => {
    const aliases = new Map<string, string | null>();
    for (const story of stories) for (const id of story.legacyIds ?? []) {
      aliases.set(id, !aliases.has(id) || aliases.get(id) === story.id ? story.id : null);
    }
    if (!aliases.size) return;
    setFavorites(previous => {
      const mapped = previous.map(id => aliases.get(id) ?? id);
      return mapped.some((id, index) => previous[index] !== id) ? [...new Set(mapped)] : previous;
    });
  }, []);

  const isFavorite = useCallback((id: string) => {
    return favorites.includes(id);
  }, [favorites]);

  return { favorites, toggleFavorite, isFavorite, resolveAliases };
}
