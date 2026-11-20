import { useCallback, useEffect, useState } from 'react';
import { readFeaturedGame, resolveFeaturedGame, writeFeaturedGame } from '../lib/featuredPreference';

export function useFeaturedGame(configuredGames: string[] | null) {
  const [preferred, setPreferred] = useState(readFeaturedGame);
  const game = resolveFeaturedGame(preferred, configuredGames);
  const chooseGame = useCallback((nextGame: string) => {
    const next = resolveFeaturedGame(nextGame, configuredGames);
    setPreferred(next);
    writeFeaturedGame(next);
  }, [configuredGames]);
  useEffect(() => {
    if (preferred !== game) {
      setPreferred(game);
      writeFeaturedGame(game);
    }
  }, [game, preferred]);
  // Keep the remembered option visible while the source configuration loads.
  const games = configuredGames ?? (game ? [game] : []);
  return { game, games, chooseGame };
}
