import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface LocationEntry {
  path: string;
  back?: string;
  restoreTop?: number;
}

function currentLocation(): LocationEntry {
  const state = window.history.state;
  return { path: window.location.pathname, back: state?.readingFrom };
}

export function useReadingHistory() {
  const [location, setLocation] = useState(currentLocation);
  const mainRef = useRef<HTMLElement>(null);
  const leavingEvent = useRef<{ path: string; top: number } | undefined>(undefined);

  const navigate = useCallback((path: string) => {
    const readingFrom = window.location.pathname;
    if (readingFrom === path) return;
    const readingTop = window.scrollY;
    window.history.pushState({ readingFrom, readingTop }, '', path);
    leavingEvent.current = path.startsWith('/events/') ? { path: readingFrom, top: readingTop } : undefined;
    setLocation({ path, back: readingFrom, restoreTop: 0 });
  }, []);

  const goBackToList = useCallback((path: string) => {
    if (window.history.state?.readingFrom === path && !path.startsWith('/events/')) window.history.back();
    else navigate(path);
  }, [navigate]);

  useEffect(() => {
    const state = window.history.state;
    if (window.location.pathname.startsWith('/events/') && typeof state?.readingTop === 'number') {
      leavingEvent.current = { path: state.readingFrom, top: state.readingTop };
    }
    const handlePop = () => {
      const next = currentLocation();
      const recent = leavingEvent.current;
      if (recent?.path === next.path) next.restoreTop = recent.top;
      const state = window.history.state;
      leavingEvent.current = next.path.startsWith('/events/') && typeof state?.readingTop === 'number'
        ? { path: state.readingFrom, top: state.readingTop } : undefined;
      setLocation(next);
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  useLayoutEffect(() => {
    const target = location.restoreTop;
    if (target === undefined) return;
    const scroll = (top: number) => window.scrollTo({ top, behavior: 'instant' });
    // Initial skeletons may be shorter than the saved position. Wait until
    // fetched content can fit the exact position, rather than clamping to top.
    const availableTop = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (target <= availableTop()) {
      scroll(target);
      return;
    }
    const stop = () => {
      observer.disconnect();
      window.clearTimeout(timeout);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
      window.removeEventListener('keydown', stopOnScrollKey);
    };
    const stopOnScrollKey = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) stop();
    };
    const observer = new ResizeObserver(() => {
      if (target <= availableTop()) {
        scroll(target);
        stop();
      }
    });
    const timeout = window.setTimeout(() => {
      scroll(Math.min(target, availableTop()));
      stop();
    }, 8_000);
    if (mainRef.current) observer.observe(mainRef.current);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    window.addEventListener('keydown', stopOnScrollKey);
    return stop;
  }, [location]);

  return { location, mainRef, navigate, goBackToList };
}
