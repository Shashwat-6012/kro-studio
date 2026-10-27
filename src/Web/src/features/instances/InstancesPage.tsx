import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Box, Database, GitBranch, Plus, Trash2, Pencil } from 'lucide-react';
import { useDefinitions, useDeleteInstance, useInstances } from '../../api/hooks';
import type { K8sObject } from '../../api/types';
import { useNamespace } from '../../app/NamespaceProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { FilterChips } from '../../components/FilterChips';
import { PageHeader } from '../../components/PageHeader';
import { SearchInput } from '../../components/SearchInput';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDate } from '../../lib/format';
import { instanceStatus, objectName, objectNamespace } from '../../lib/k8s';
import { toneOf } from '../../lib/status';
import { instanceTemplate } from '../../lib/templates';
import { InstanceEditorDialog } from './InstanceEditorDialog';
import { useInstanceScope } from './useInstanceScope';

type StatusFilter = 'all' | 'success' | 'warning' | 'danger';

export function InstancesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { namespace, setNamespace } = useNamespace();
  const { data: definitions = [], isPending } = useDefinitions();
  const graph = params.get('graph') ?? definitions.find((d) => d.generatedKind)?.name ?? definitions[0]?.name;
  const scope = useInstanceScope(graph);

  const [tokens, setTokens] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [namespaceDraft, setNamespaceDraft] = useState(namespace);
  const [creating, setCreating] = useState(params.get('create') === '1');
  const [editing, setEditing] = useState<K8sObject | null>(null);
  const [deleting, setDeleting] = useState<K8sObject | null>(null);
  const remove = useDeleteInstance();

  useEffect(() => setNamespaceDraft(namespace), [namespace]);
  useEffect(() => { setPage(0); setTokens([null]); }, [graph, scope.namespace]);

  const { data, isFetching, isPending: loadingInstances } = useInstances(graph, scope.namespace, tokens[page] ?? null, scope.ready && Boolean(scope.definition?.generatedKind));
  const items = data?.items ?? [];

  const counts = useMemo(() => ({
    all: items.length,
    success: items.filter((i) => toneOf(instanceStatus(i)) === 'success').length,
    warning: items.filter((i) => toneOf(instanceStatus(i)) === 'warning').length,
    danger: items.filter((i) => toneOf(instanceStatus(i)) === 'danger').length,
  }), [items]);
  const filtered = useMemo(() => items.filter((item) =>
    `${objectName(item)} ${objectNamespace(item)}`.toLowerCase().includes(search.toLowerCase()) && (status === 'all' || toneOf(instanceStatus(item)) === status)), [items, search, status]);

  const open = (item: K8sObject) => {
    const ns = item.metadata?.namespace;
    navigate(`/instances/${encodeURIComponent(graph!)}/${encodeURIComponent(objectName(item))}${ns ? `?ns=${encodeURIComponent(ns)}` : ''}`);
  };
  const closeCreate = () => { setCreating(false); if (params.has('create')) { const next = new URLSearchParams(params); next.delete('create'); setParams(next, { replace: true }); } };
  const chooseGraph = (name: string) => setParams({ graph: name });
  const canCreate = Boolean(scope.definition?.generatedKind && scope.api);

  const columns: Column<K8sObject>[] = [
    { key: 'name', header: 'Name', width: '1.6fr', render: (item) => <span className="name-cell"><span className="icon-tile"><Box size={16} /></span><span><b>{objectName(item)}</b></span></span> },
    { key: 'ns', header: 'Namespace', width: '1fr', hideOnSmall: true, render: (item) => <span className="muted-text">{objectNamespace(item)}</span> },
    { key: 'status', header: 'Status', width: '1fr', render: (item) => <StatusBadge status={instanceStatus(item)} /> },
    { key: 'created', header: 'Created', width: '1fr', hideOnSmall: true, render: (item) => <span className="muted-text">{formatDate(item.metadata?.creationTimestamp)}</span> },
    { key: 'actions', header: '', width: '112px', align: 'right', render: (item) => (
      <span className="row-actions" onClick={(event) => event.stopPropagation()}>
        <button aria-label="Edit instance" title="Edit YAML" onClick={() => setEditing(item)}><Pencil size={14} /></button>
        <button aria-label="Delete instance" title="Delete" onClick={() => setDeleting(item)}><Trash2 size={14} /></button>
        <button aria-label="Inspect instance" title="Inspect" onClick={() => open(item)}><ArrowRight size={15} /></button>
      </span>
    ) },
  ];

  return (
    <>
      <PageHeader title="Instances" subtitle="Live custom resources managed by KRO. Open one to see how it is composed." actions={<button className="btn btn--primary" onClick={() => setCreating(true)} disabled={!canCreate}><Plus size={16} />Create instance</button>} />
      <div className="toolbar toolbar--card">
        <Field label="Resource graph">
          <select value={graph ?? ''} onChange={(event) => chooseGraph(event.target.value)} disabled={!definitions.length}>
            {definitions.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.generatedKind ?? 'API pending'}</option>)}
          </select>
        </Field>
        {scope.namespaced && (
          <Field label="Namespace">
            <input value={namespaceDraft} placeholder="default" onChange={(event) => setNamespaceDraft(event.target.value)} onBlur={() => setNamespace(namespaceDraft)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          </Field>
        )}
        <SearchInput value={search} onChange={setSearch} placeholder="Search instances…" className="toolbar__grow" />
      </div>
      <div className="toolbar">
        <FilterChips<StatusFilter> active={status} onChange={setStatus} items={[
          { id: 'all', label: 'All', count: counts.all }, { id: 'success', label: 'Ready', count: counts.success },
          { id: 'warning', label: 'Processing', count: counts.warning }, { id: 'danger', label: 'Failed', count: counts.danger },
        ]} />
        <span className="toolbar__note">{isFetching && !loadingInstances ? 'Refreshing…' : 'Auto-refreshes every few seconds'}</span>
      </div>
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(item) => `${objectNamespace(item)}/${objectName(item)}`}
        onRowClick={open}
        loading={isPending || (Boolean(graph) && (!scope.ready || loadingInstances) && Boolean(scope.definition?.generatedKind))}
        loadingTitle="Reading generated resources from the cluster…"
        empty={!graph
          ? <EmptyState icon={<GitBranch size={20} />} title="No resource graphs available" detail="Create a resource graph to start managing instances." />
          : !scope.definition?.generatedKind
            ? <EmptyState icon={<Database size={20} />} title="Generated API is not ready" detail="This definition needs a generated API kind before instances can be listed." />
            : <EmptyState icon={<Box size={20} />} title={search || status !== 'all' ? 'No matching instances' : 'No instances yet'} detail={search || status !== 'all' ? 'Change the search or status filter.' : 'Create an instance to apply this resource graph to your cluster.'} action={<button className="link-btn" onClick={() => setCreating(true)}>Create instance <ArrowRight size={14} /></button>} />}
        footer={<>
          <span>Page <b>{page + 1}</b> · {filtered.length} shown</span>
          <span className="pager">
            <button disabled={page === 0 || isFetching} onClick={() => setPage(page - 1)}>Previous</button>
            <button disabled={!data?.continue || isFetching} onClick={() => { const next = data!.continue!; setTokens([...tokens.slice(0, page + 1), next]); setPage(page + 1); }}>Next</button>
          </span>
        </>}
      />

      {creating && scope.api && <InstanceEditorDialog mode="create" definition={graph!} namespace={scope.namespace} initial={instanceTemplate(scope.api, namespace)} onClose={closeCreate} />}
      {editing && <InstanceEditorDialog mode="edit" definition={graph!} namespace={editing.metadata?.namespace ?? scope.namespace} initial={editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${objectName(deleting)}”?`}
          description="KRO removes the composed resources that belong to this instance."
          confirmLabel="Delete instance"
          danger
          busy={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove.mutate({ definition: graph!, name: objectName(deleting), namespace: deleting.metadata?.namespace ?? scope.namespace }, { onSettled: () => setDeleting(null) })}
        />
      )}
    </>
  );
}
