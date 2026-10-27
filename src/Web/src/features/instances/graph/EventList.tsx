import { Activity } from 'lucide-react';
import type { K8sObject } from '../../../api/types';
import { EmptyState } from '../../../components/EmptyState';
import { StatusBadge } from '../../../components/StatusBadge';
import { timeAgo } from '../../../lib/format';

export function EventList({ events, emptyTitle = 'No related events', emptyDetail = 'No Kubernetes events were returned.' }: { events: K8sObject[]; emptyTitle?: string; emptyDetail?: string }) {
  if (!events.length) return <EmptyState icon={<Activity size={20} />} title={emptyTitle} detail={emptyDetail} />;
  const sorted = [...events].sort((a, b) => new Date(b.lastTimestamp ?? b.eventTime ?? 0).valueOf() - new Date(a.lastTimestamp ?? a.eventTime ?? 0).valueOf());
  return (
    <div className="event-list">
      {sorted.map((event, index) => (
        <div className="event-row" key={event.metadata?.uid ?? index}>
          <StatusBadge compact status={event.type === 'Warning' ? 'Warning' : 'Normal'} />
          <div>
            <b>{event.reason ?? 'Event'}{event.count > 1 ? <em> ×{event.count}</em> : null}</b>
            <p>{event.message ?? 'No event message'}</p>
            <small>{event.involvedObject?.kind ? `${event.involvedObject.kind}/${event.involvedObject.name} · ` : ''}{event.source?.component ?? 'Kubernetes'} · {timeAgo(event.lastTimestamp ?? event.eventTime)}</small>
          </div>
        </div>
      ))}
    </div>
  );
}
