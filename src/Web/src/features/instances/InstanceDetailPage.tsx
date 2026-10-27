import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Box, Pencil, Radio, Trash2 } from 'lucide-react';
import { useDeleteInstance, useInstance, useInstanceEvents, useInstanceResources } from '../../api/hooks';
import { messageOf } from '../../api/client';
import { BackLink } from '../../components/BackLink';
import { CodePanel } from '../../components/CodePanel';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState, LoadingState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Tabs } from '../../components/Tabs';
import { useTabParam } from '../../hooks/useTabParam';
import { formatDate } from '../../lib/format';
import { instanceStatus, objectName, objectNamespace } from '../../lib/k8s';
import { EventList } from './graph/EventList';
import { Inspector } from './graph/Inspector';
import { buildModel, INSTANCE_NODE_ID } from './graph/model';
import { ResourceGraph } from './graph/ResourceGraph';
import { InstanceEditorDialog } from './InstanceEditorDialog';
import { InstanceOverview } from './InstanceOverview';
import { useInstanceScope } from './useInstanceScope';

const TABS = ['graph', 'overview', 'events', 'yaml'] as const;

export function InstanceDetailPage() {
  const { graph = '', name = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [tab, setTab] = useTabParam(TABS, 'graph');
  const scope = useInstanceScope(graph, params.get('ns'));
  const [live, setLive] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useDeleteInstance();

  const instanceQuery = useInstance(graph, name, scope.namespace, live, scope.ready);
  const resourcesQuery = useInstanceResources(graph, name, scope.namespace, live, scope.ready);
  const eventsQuery = useInstanceEvents(graph, name, scope.eventNamespace, live, scope.ready);
  const instance = instanceQuery.data;
  const resources = useMemo(() => resourcesQuery.data?.resources ?? [], [resourcesQuery.data]);
  const events = useMemo(() => eventsQuery.data?.items ?? [], [eventsQuery.data]);
  const warnings = [...(resourcesQuery.data?.warnings ?? []), ...(resourcesQuery.error ? [messageOf(resourcesQuery.error)] : [])];
  const model = useMemo(() => (instance ? buildModel(instance, resources) : { nodes: [], edges: [] }), [instance, resources]);
  const selected = model.nodes.find((node) => node.id === selectedId) ?? null;

  const back = <BackLink to={`/instances?graph=${encodeURIComponent(graph)}`} label="Instances" current={name} />;
  if (instanceQuery.isError) return <>{back}<EmptyState icon={<Box size={20} />} title="Instance not available" detail={messageOf(instanceQuery.error)} action={<Link className="link-btn" to="/instances">Back to instances</Link>} /></>;
  if (!instance) return <>{back}<LoadingState title="Loading instance…" /></>;

  const status = instanceStatus(instance);
  const failing = model.nodes.filter((node) => node.type === 'resource' && node.tone === 'danger').length;

  return (
    <>
      {back}
      <PageHeader
        title={<>{objectName(instance)} <StatusBadge status={status} /></>}
        subtitle={`${instance.kind ?? scope.definition?.generatedKind} · ${objectNamespace(instance)} · ${instance.apiVersion}`}
        actions={<>
          <button className={`btn btn--toggle ${live ? 'is-on' : ''}`} onClick={() => setLive(!live)} aria-pressed={live} title="Refresh status every few seconds"><Radio size={15} />{live ? 'Live' : 'Paused'}</button>
          <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} />Edit YAML</button>
          <button className="btn btn--danger" onClick={() => setDeleting(true)}><Trash2 size={15} />Delete</button>
        </>}
      />
      <div className="stat-strip">
        <div><span>Status</span><StatusBadge status={status} /></div>
        <div><span>Namespace</span><b>{objectNamespace(instance)}</b></div>
        <div><span>Created</span><b>{formatDate(instance.metadata?.creationTimestamp)}</b></div>
        <div><span>Resource graph</span><b><Link to={`/graphs/${encodeURIComponent(graph)}`}>{graph}</Link></b></div>
        <div><span>Composed resources</span><b>{resources.length}{failing ? ` · ${failing} failing` : ''}</b></div>
      </div>
      <Tabs active={tab} onChange={setTab} items={[{ id: 'graph', label: 'Resource graph', count: resources.length }, { id: 'overview', label: 'Overview' }, { id: 'events', label: 'Events', count: events.length }, { id: 'yaml', label: 'YAML' }]} />

      {tab === 'graph' && (
        <section className="explorer">
          <div className="card explorer__graph">
            {warnings.map((warning) => <div className="callout callout--warning" key={warning}>{warning}</div>)}
            {resourcesQuery.isPending ? <LoadingState title="Loading composed resources…" /> : <ResourceGraph instance={instance} resources={resources} selectedId={selectedId} onSelect={setSelectedId} />}
          </div>
          {selected
            ? <Inspector key={selected.id} node={selected} definition={graph} instanceName={name} namespace={scope.namespace} events={events} onClose={() => setSelectedId(null)} />
            : <aside className="inspector inspector--empty"><EmptyState icon={<Box size={20} />} title="Select a node" detail="Click any resource in the graph to see its status, YAML, logs, and events." action={<button className="link-btn" onClick={() => setSelectedId(INSTANCE_NODE_ID)}>Inspect the instance itself</button>} /></aside>}
        </section>
      )}
      {tab === 'overview' && <InstanceOverview instance={instance} model={model} warnings={warnings} />}
      {tab === 'events' && <section className="card"><h2>Kubernetes events</h2><p className="card__sub">Events associated with this instance in {scope.eventNamespace ?? 'the cluster'}.</p><EventList events={events} /></section>}
      {tab === 'yaml' && <CodePanel title="Instance manifest" value={instance} />}

      {editing && <InstanceEditorDialog mode="edit" definition={graph} namespace={scope.namespace} initial={instance} onClose={() => setEditing(false)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${name}”?`}
          description="KRO removes the composed resources that belong to this instance."
          confirmLabel="Delete instance"
          danger
          busy={remove.isPending}
          onCancel={() => setDeleting(false)}
          onConfirm={() => remove.mutate({ definition: graph, name, namespace: scope.namespace }, { onSuccess: () => navigate(`/instances?graph=${encodeURIComponent(graph)}`), onSettled: () => setDeleting(false) })}
        />
      )}
    </>
  );
}
