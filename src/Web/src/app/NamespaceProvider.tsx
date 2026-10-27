import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { readStorage, writeStorage } from '../lib/storage';

type NamespaceContextValue = { namespace: string; setNamespace: (value: string) => void };
const NamespaceContext = createContext<NamespaceContextValue | null>(null);
const KEY = 'kro-studio:namespace';

export function NamespaceProvider({ children }: { children: ReactNode }) {
  const [namespace, setState] = useState(() => readStorage(KEY, 'default'));
  const value = useMemo<NamespaceContextValue>(() => ({
    namespace,
    setNamespace: (next) => { const clean = next.trim(); setState(clean); writeStorage(KEY, clean); },
  }), [namespace]);
  return <NamespaceContext.Provider value={value}>{children}</NamespaceContext.Provider>;
}

export function useNamespace(): NamespaceContextValue {
  const context = useContext(NamespaceContext);
  if (!context) throw new Error('useNamespace must be used inside <NamespaceProvider>');
  return context;
}
