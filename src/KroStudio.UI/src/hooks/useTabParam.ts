import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Keeps the active tab in the URL (?tab=...) so refresh and sharing work. */
export function useTabParam<T extends string>(tabs: readonly T[], fallback: T): [T, (tab: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as T | null;
  const tab = raw && tabs.includes(raw) ? raw : fallback;
  const setTab = useCallback((next: T) => {
    setParams((current) => {
      const copy = new URLSearchParams(current);
      copy.set('tab', next);
      return copy;
    }, { replace: true });
  }, [setParams]);
  return [tab, setTab];
}
