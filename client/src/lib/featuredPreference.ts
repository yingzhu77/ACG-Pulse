export const FEATURED_GAME_KEY = 'acg_pulse_featured_game';

type LocalPreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type StorageAccess = () => LocalPreferenceStorage;
const browserStorage: StorageAccess = () => window.localStorage;

function cleanGame(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  return name.length <= 100 && ![...name].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) ? name : '';
}

export function readFeaturedGame(storage: StorageAccess = browserStorage): string {
  try {
    const raw = storage().getItem(FEATURED_GAME_KEY);
    return raw ? cleanGame(JSON.parse(raw)) : '';
  } catch { return ''; }
}

export function writeFeaturedGame(game: string, storage: StorageAccess = browserStorage): void {
  try {
    const name = cleanGame(game);
    if (name) storage().setItem(FEATURED_GAME_KEY, JSON.stringify(name));
    else storage().removeItem(FEATURED_GAME_KEY);
  } catch { /* A blocked or full store should not prevent filtering in this tab. */ }
}

export function resolveFeaturedGame(saved: string, configuredGames: string[] | null): string {
  const name = cleanGame(saved);
  // A pending/failed network load is not evidence that a game was removed.
  return configuredGames === null || configuredGames.includes(name) ? name : '';
}
