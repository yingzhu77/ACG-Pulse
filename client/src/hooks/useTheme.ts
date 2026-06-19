import { useState, useEffect } from 'react';
import { isTheme, type Theme } from '../constants';

const THEME_STORAGE_KEY = 'game_pulse_theme';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const requestedTheme = new URLSearchParams(window.location.search).get('theme');
    if (isTheme(requestedTheme)) return requestedTheme;

    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(storedTheme) ? storedTheme : 'dark';
  });

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  }, [theme]);

  return { theme, setTheme } as const;
}
