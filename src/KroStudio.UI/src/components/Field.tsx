import type { ReactNode } from 'react';

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className ?? ''}`}><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}
