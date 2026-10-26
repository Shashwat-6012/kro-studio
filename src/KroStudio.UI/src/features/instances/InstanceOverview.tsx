import { Activity } from 'lucide-react';
import type { K8sObject } from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { timeAgo } from '../../lib/format';
import { conditionsOf } from '../../lib/k8s';
import type { GraphModel } from './graph/model';

export function InstanceOverview({ instance, model, warnings }: { instance: K8sObject; model: GraphModel; warnings: string[] }) {
  const conditions = conditionsOf(instance);
  const resources = model.nodes.filter((node) => node.type === 'resource');
  const failing = resources.filter((node) => node.tone === 'danger');
  const labels = Object.entries(instance.metadata?.labels ?? {});

  return (
    <div className="two-col">
      <section className="card">
        <div className="card__heading"><div><h2>Status conditions</h2><p>Reported by the KRO controller.</p></div>{instance.status?.state && <StatusBadge status={String(instance.status.state).replace('_', ' ')} />}</div>
        {conditions.length ? (
          <div className="condition-list">
            {conditions.map((condition, index) => (
              <div className="condition-row" key={index}>
                <b>{condition.type}</b>
                <StatusBadge compact status={condition.status === 'True' ? 'Ready' : condition.status === 'False' ? 'Failed' : condition.status ?? 'Unknown'} />
                <div>{condition.reason && <b>{condition.reason}</b>}{condition.message && <p>{condition.message}</p>}<small>{timeAgo(condition.lastTransitionTime)}</small></div>
              </div>
            ))}
          </div>
        ) : <div className="inline-empty"><Activity size={16} />No status conditions reported.</div>}
      </section>
      <section className="card">
        <h2>Composition</h2>
        <p className="card__sub">{resources.length} composed {resources.length === 1 ? 'resource' : 'resources'}{failing.length ? `, ${failing.length} failing` : ''}.</p>
        {warnings.map((warning) => <div className="callout callout--warning" key={warning}>{warning}</div>)}
        {failing.length > 0 && <div className="list">{failing.map((node) => <div className="list-row" key={node.id}><div><b>{node.name}</b><small>{node.kind}</small></div><StatusBadge status={node.status} tone={node.tone} compact /></div>)}</div>}
        {labels.length > 0 && <><h3 className="card__subhead">Labels</h3><div className="tag-list">{labels.map(([key, value]) => <span className="tag" key={key}>{key}={value}</span>)}</div></>}
      </section>
    </div>
  );
}
