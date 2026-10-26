import type { ReactNode } from 'react';

export function EmptyState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">{icon}</div>
      <b>{title}</b>
      {detail && <span>{detail}</span>}
      {action}
    </div>
  );
}

export function LoadingState({ title = 'Loading…', detail }: { title?: string; detail?: string }) {
  return (
    <div className="empty-state">
      <div className="spinner" />
      <b>{title}</b>
      {detail && <span>{detail}</span>}
    </div>
  );
}
