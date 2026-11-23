const PREFIX = 'acg_pulse_read_v1:';
const FILTER_KEY = PREFIX + 'only_unread';

export function isReadStateKey(key: string | null) {
  return key === null || key.startsWith(PREFIX);
}

type ReadStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function createEventReadState(storage: () => ReadStorage) {
  // Retain just the failed writes when storage is unavailable in this tab.
  const unsaved = new Map<string, string>();
  function get(key: string) {
    if (unsaved.has(key)) return unsaved.get(key);
    try { return storage().getItem(key); } catch { return null; }
  }
  function set(key: string, value: string) {
    try { storage().setItem(key, value); unsaved.delete(key); }
    catch { unsaved.set(key, value); }
  }
  // Independent marks prevent concurrent tabs from overwriting each other's progress.
  function keys(eventId: string, progressIds: string[]) {
    const base = PREFIX + 'event:' + encodeURIComponent(eventId);
    return [base, ...progressIds.map(id => base + ':' + encodeURIComponent(id))];
  }
  return {
    hasRead(eventId: string, progressIds: string[]) {
      return keys(eventId, progressIds).every(key => get(key) === '1');
    },
    markRead(eventId: string, progressIds: string[]) {
      for (const key of keys(eventId, progressIds)) if (get(key) !== '1') set(key, '1');
    },
    onlyUnread: () => get(FILTER_KEY) === '1',
    setOnlyUnread: (enabled: boolean) => set(FILTER_KEY, enabled ? '1' : '0')
  };
}

export const eventReadState = createEventReadState(() => window.localStorage);
