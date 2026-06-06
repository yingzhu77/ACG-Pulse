import { useState, useEffect } from 'react';
import type { Theme } from '../constants';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const requestedTheme = new URLSearchParams(window.location.search).get('theme');
    if (requestedTheme === 'light' || requestedTheme === 'dark') return requestedTheme;
    return (localStorage.getItem('game_pulse_theme') as Theme) || 'dark';
  });

  useEffect(() => {
    localStorage.setItem('game_pulse_theme', theme);
  }, [theme]);

  return { theme, setTheme } as const;
}
