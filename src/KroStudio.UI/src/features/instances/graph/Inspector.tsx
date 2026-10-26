import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useResourceLogs } from '../../../api/hooks';
import type { K8sObject } from '../../../api/types';
import { messageOf } from '../../../api/client';
import { CodePanel } from '../../../components/CodePanel';
import { StatusBadge } from '../../../components/StatusBadge';
import { Tabs } from '../../../components/Tabs';
import { formatDate, timeAgo } from '../../../lib/format';
import { canShowLogs, conditionsOf } from '../../../lib/k8s';
import { EventList } from './EventList';
import { KindIcon } from './nodes';
import type { ModelNode } from './model';

type InspectorTab = 'details' | 'yaml' | 'logs' | 'events';
type Props = { node: ModelNode; definition: string; instanceName: string; namespace?: string; events: K8sObject[]; onClose: () => void };

export function Inspector({ node, definition, instanceName, namespace, events, onClose }: Props) {
  const [tab, setTab] = useState<InspectorTab>('details');
  const loggable = node.type === 'resource' && canShowLogs(node.kind);
  const activeTab = tab === 'logs' && !loggable ? 'details' : tab;
  const relatedEvents = node.type === 'instance' ? events : events.filter((event) => event.involvedObject?.name === node.name);
  const items = [
    { id: 'details' as const, label: 'Details' },
    { id: 'yaml' as const, label: 'YAML' },
    ...(loggable ? [{ id: 'logs' as const, label: 'Logs' }] : []),
    { id: 'events' as const, label: 'Events', count: relatedEvents.length },
  ];

  return (
    <aside className="inspector">
      <div className="inspector__header">
        <span className="icon-tile"><KindIcon kind={node.kind} /></span>
        <div><b title={node.name}>{node.name}</b><small>{node.kind}{node.resourceId ? ` · ${node.resourceId}` : ''}</small></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close inspector"><X size={16} /></button>
      </div>
      <Tabs items={items} active={activeTab} onChange={setTab} />
      <div className="inspector__body">
        {activeTab === 'details' && <Details node={node} />}
        {activeTab === 'yaml' && <CodePanel bare title="Manifest" value={node.object} />}
        {activeTab === 'logs' && <Logs definition={definition} instanceName={instanceName} resourceName={node.name} namespace={namespace} />}
        {activeTab === 'events' && <EventList events={relatedEvents} emptyDetail="No events were recorded for this object." />}
      </div>
    </aside>
  );
}

function Details({ node }: { node: ModelNode }) {
  const object = node.object;
  const conditions = conditionsOf(object);
  const owners = object.metadata?.ownerReferences ?? [];
  return (
    <>
      <dl className="kv">
        <div><dt>Status</dt><dd><StatusBadge status={node.status} tone={node.tone} compact /></dd></div>
        <div><dt>API version</dt><dd>{object.apiVersion ?? '—'}</dd></div>
        <div><dt>Namespace</dt><dd>{object.metadata?.namespace ?? 'Cluster-scoped'}</dd></div>
        {node.resourceId && <div><dt>KRO resource id</dt><dd>{node.resourceId}</dd></div>}
        <div><dt>Created</dt><dd>{formatDate(object.metadata?.creationTimestamp)}</dd></div>
        {owners.length > 0 && <div><dt>Owned by</dt><dd>{owners.map((owner) => owner.name ?? owner.kind).join(', ')}</dd></div>}
      </dl>
      {conditions.length > 0 && (
        <div className="condition-list condition-list--tight">
          {conditions.map((condition, index) => (
            <div className="condition-row condition-row--stack" key={index}>
              <span><b>{condition.type}</b><StatusBadge compact status={condition.status === 'True' ? 'Ready' : condition.status === 'False' ? 'Failed' : condition.status ?? 'Unknown'} /></span>
              {(condition.reason || condition.message) && <p>{condition.reason}{condition.reason && condition.message ? ' — ' : ''}{condition.message}</p>}
              <small>{timeAgo(condition.lastTransitionTime)}</small>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Logs({ definition, instanceName, resourceName, namespace }: { definition: string; instanceName: string; resourceName: string; namespace?: string }) {
  const logs = useResourceLogs(definition, instanceName, resourceName, namespace, true);
  return (
    <div className="logs">
      <div className="logs__bar">
        <span>Recent output</span>
        <button className="btn btn--sm" onClick={() => void logs.refetch()} disabled={logs.isFetching}><RefreshCw size={13} className={logs.isFetching ? 'spin' : ''} />Refresh</button>
      </div>
      {logs.isPending ? <div className="inline-empty">Loading recent logs…</div>
        : logs.isError ? <div className="callout callout--danger">{messageOf(logs.error)}</div>
        : logs.data?.length ? logs.data.map((entry) => (
          <section className="log-container" key={`${entry.podName}-${entry.container}`}>
            <div><b>{entry.podName}</b><small>{entry.container}</small></div>
            <pre>{entry.text || 'No recent output.'}</pre>
          </section>
        )) : <div className="inline-empty">No pod logs are available. Logs appear for Pods and workloads with matching Pods.</div>}
    </div>
  );
}

