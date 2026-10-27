import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Activity, Box, GitBranch, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useDefinitionManifest, useDefinitions, useDeleteDefinition, useGeneratedApiFor, useRetryDefinition } from '../../api/hooks';
import type { Condition } from '../../api/types';
import { BackLink } from '../../components/BackLink';
import { CodePanel } from '../../components/CodePanel';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState, LoadingState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Tabs } from '../../components/Tabs';
import { useTabParam } from '../../hooks/useTabParam';
import { formatDate, timeAgo } from '../../lib/format';
import { cleanForEdit, toYaml } from '../../lib/yaml';
import { RgdEditorDialog } from './RgdEditorDialog';

const TABS = ['overview', 'schema', 'resources', 'yaml'] as const;

export function ResourceGraphDetailPage() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useTabParam(TABS, 'overview');
  const { data: definitions, isPending } = useDefinitions();
  const { data: manifest } = useDefinitionManifest(name);
  const definition = definitions?.find((item) => item.name === name);
  const { api } = useGeneratedApiFor(definition);
  const retry = useRetryDefinition();
  const remove = useDeleteDefinition();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const schema = manifest?.spec?.schema ?? {};
  const resources = useMemo(() => {
    const raw = manifest?.spec?.resources;
    if (Array.isArray(raw)) return raw as Record<string, any>[];
    if (raw && typeof raw === 'object') return Object.entries(raw).map(([id, template]) => ({ id, template }));
    return [];
  }, [manifest]);

  if (isPending) return <LoadingState title="Loading resource graph…" />;
  if (!definition) return <><BackLink to="/graphs" label="Resource graphs" current={name} /><EmptyState icon={<GitBranch size={20} />} title="Resource graph not found" detail={`“${name}” does not exist in this cluster.`} action={<Link className="link-btn" to="/graphs">Back to resource graphs</Link>} /></>;

  const conditions: Condition[] = Array.isArray(manifest?.status?.conditions) ? manifest!.status!.conditions : [];

  return (
    <>
      <BackLink to="/graphs" label="Resource graphs" current={definition.name} />
      <PageHeader
        title={definition.name}
        subtitle={`${definition.kind} · ${definition.apiVersion}`}
        actions={<>
          <button className="btn" onClick={() => retry.mutate(definition.name)} disabled={retry.isPending}><RefreshCw size={15} className={retry.isPending ? 'spin' : ''} />Retry reconciliation</button>
          <button className="btn" onClick={() => setEditing(true)} disabled={!manifest}><Pencil size={15} />Edit YAML</button>
          <button className="btn btn--danger" onClick={() => setDeleting(true)}><Trash2 size={15} />Delete</button>
          <button className="btn btn--primary" onClick={() => navigate(`/instances?graph=${encodeURIComponent(definition.name)}&create=1`)} disabled={!definition.generatedKind}><Plus size={16} />Create instance</button>
        </>}
      />
      <Tabs active={tab} onChange={setTab} items={[{ id: 'overview', label: 'Overview' }, { id: 'schema', label: 'Schema' }, { id: 'resources', label: 'Resources', count: resources.length }, { id: 'yaml', label: 'YAML' }]} />

      {tab === 'overview' && (
        <>
          <div className="stat-strip">
            <div><span>Status</span><StatusBadge status={definition.readiness} /></div>
            <div><span>Generated API</span><b>{definition.generatedKind ?? 'Pending discovery'}</b></div>
            <div><span>Scope</span><b>{api ? (api.namespaced ? 'Namespaced instances' : 'Cluster-scoped instances') : 'Cluster-scoped definition'}</b></div>
            <div><span>Created</span><b>{formatDate(definition.createdAt)}</b></div>
          </div>
          <div className="two-col">
            <section className="card">
              <div className="card__heading"><div><h2>Conditions</h2><p>Latest KRO processing signals.</p></div>{manifest?.status?.state && <StatusBadge status={String(manifest.status.state)} />}</div>
              {conditions.length ? (
                <div className="condition-list">
                  {conditions.map((condition, index) => (
                    <div className="condition-row" key={index}>
                      <b>{condition.type ?? 'Condition'}</b>
                      <StatusBadge compact status={condition.status === 'True' ? 'Ready' : condition.status === 'False' ? 'Failed' : condition.status ?? 'Unknown'} />
                      <div>{condition.reason && <b>{condition.reason}</b>}{condition.message && <p>{condition.message}</p>}<small>{timeAgo(condition.lastTransitionTime)}</small></div>
                    </div>
                  ))}
                </div>
              ) : <div className="inline-empty"><Activity size={16} />No condition details reported by the cluster.</div>}
            </section>
            <section className="card">
              <h2>Details</h2>
              <dl className="kv">
                <div><dt>Name</dt><dd>{definition.name}</dd></div>
                <div><dt>API version</dt><dd>{definition.apiVersion}</dd></div>
                <div><dt>Resource version</dt><dd>{manifest?.metadata?.resourceVersion ?? '—'}</dd></div>
                <div><dt>Spec properties</dt><dd>{Object.keys(schema.spec ?? {}).join(', ') || 'None declared'}</dd></div>
                {api && <div><dt>Instances</dt><dd><Link to={`/instances?graph=${encodeURIComponent(definition.name)}`}>Browse {api.kind} instances</Link></dd></div>}
              </dl>
            </section>
          </div>
        </>
      )}
      {tab === 'schema' && <CodePanel title="Generated instance schema" value={schema} empty="The API schema is not present in this definition." />}
      {tab === 'resources' && (
        <section className="card">
          <h2>Declared resources</h2>
          <p className="card__sub">Resource templates declared in this graph.</p>
          {resources.length ? (
            <div className="list">
              {resources.map((resource, index) => (
                <div className="list-row" key={resource.id ?? index}>
                  <span className="icon-tile"><Box size={16} /></span>
                  <div><b>{resource.id ?? `Resource ${index + 1}`}</b><small>{resource.template?.apiVersion ?? 'Unknown API'} · {resource.template?.kind ?? 'Unknown kind'}</small></div>
                  <code>{resource.template?.metadata?.name ?? 'Name generated from schema'}</code>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={<Box size={20} />} title="No declared resources" detail="This definition does not contain a resources list." />}
        </section>
      )}
      {tab === 'yaml' && <CodePanel title="Manifest" value={manifest} empty="Manifest is unavailable." />}

      {editing && manifest && <RgdEditorDialog mode="edit" definitionName={definition.name} initialYaml={toYaml(cleanForEdit(manifest))} onClose={() => setEditing(false)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${definition.name}”?`}
          description="The resource graph definition is removed from the cluster. Instances of its generated API may stop reconciling."
          confirmLabel="Delete resource graph"
          danger
          busy={remove.isPending}
          onCancel={() => setDeleting(false)}
          onConfirm={() => remove.mutate(definition.name, { onSuccess: () => navigate('/graphs'), onSettled: () => setDeleting(false) })}
        />
      )}
    </>
  );
}
