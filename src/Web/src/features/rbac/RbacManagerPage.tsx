import { useMemo, useState } from 'react';
import { FilePlus2, RefreshCw, Shield, Trash2, UsersRound } from 'lucide-react';
import { useCreateRbacObject, useDeleteRbacObject, useRbacObjects, useUpdateRbacObject } from '../../api/hooks';
import type { K8sObject, RbacObjectKind } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { ManifestEditorDialog } from '../../components/ManifestEditorDialog';
import { PageHeader } from '../../components/PageHeader';
import { SearchInput } from '../../components/SearchInput';
import { cleanForEdit, toYaml } from '../../lib/yaml';
import { messageOf } from '../../api/client';

const kinds: { kind: RbacObjectKind; label: string; namespaced: boolean }[] = [
  { kind: 'ClusterRole', label: 'ClusterRoles', namespaced: false },
  { kind: 'Role', label: 'Roles', namespaced: true },
  { kind: 'ClusterRoleBinding', label: 'ClusterRoleBindings', namespaced: false },
  { kind: 'RoleBinding', label: 'RoleBindings', namespaced: true },
];

function objectName(item: K8sObject) { return item.metadata?.name ?? '(unnamed)'; }
function objectNamespace(item: K8sObject) { return item.metadata?.namespace ?? '—'; }
function summary(item: K8sObject) {
  if (item.kind === 'Role' || item.kind === 'ClusterRole') return `${item.rules?.length ?? 0} rule${item.rules?.length === 1 ? '' : 's'}`;
  const ref = item.roleRef;
  const subjects = Array.isArray(item.subjects) ? item.subjects.length : 0;
  return `${ref?.kind ?? 'Role'} / ${ref?.name ?? 'unresolved'} · ${subjects} subject${subjects === 1 ? '' : 's'}`;
}

function blankManifest(kind: RbacObjectKind, namespace: string) {
  const namespaced = kind === 'Role' || kind === 'RoleBinding';
  const binding = kind === 'ClusterRoleBinding' || kind === 'RoleBinding';
  const scope = namespaced ? `  namespace: ${namespace || 'default'}\n` : '';
  const permissions = binding
    ? `subjects:\n  - kind: ServiceAccount\n    name: replace-me\n    namespace: ${namespace || 'default'}\nroleRef:\n  apiGroup: rbac.authorization.k8s.io\n  kind: ${kind === 'RoleBinding' ? 'Role' : 'ClusterRole'}\n  name: replace-me\n`
    : 'rules: []\n';
  return `apiVersion: rbac.authorization.k8s.io/v1\nkind: ${kind}\nmetadata:\n  name: replace-me\n${scope}${permissions}`;
}

function columns(namespaced: boolean, onEdit: (item: K8sObject) => void, onDelete: (item: K8sObject) => void): Column<K8sObject>[] {
  return [
    { key: 'name', header: 'Name', width: '1.1fr', render: (item) => <span className="name-cell"><span className="icon-tile"><Shield size={16} /></span><b>{objectName(item)}</b></span> },
    ...(namespaced ? [{ key: 'namespace', header: 'Namespace', width: '.8fr', render: (item: K8sObject) => <code>{objectNamespace(item)}</code> }] : []),
    { key: 'details', header: 'Rules / target', width: '1.4fr', render: (item) => <span className="muted-text">{summary(item)}</span> },
    { key: 'created', header: 'Created', width: '1fr', hideOnSmall: true, render: (item) => <span className="muted-text">{item.metadata?.creationTimestamp ? new Date(item.metadata.creationTimestamp).toLocaleString() : '—'}</span> },
    { key: 'actions', header: '', width: '92px', align: 'right', render: (item) => <span className="row-actions"><button className="icon-btn" title="Edit manifest" aria-label={`Edit ${objectName(item)}`} onClick={(event) => { event.stopPropagation(); onEdit(item); }}><FilePlus2 size={15} /></button><button className="icon-btn" title="Delete" aria-label={`Delete ${objectName(item)}`} onClick={(event) => { event.stopPropagation(); onDelete(item); }}><Trash2 size={15} /></button></span> },
  ];
}

export function RbacManagerPage() {
  const [kind, setKind] = useState<RbacObjectKind>('ClusterRole');
  const [namespace, setNamespace] = useState('');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; item?: K8sObject; yaml: string } | null>(null);
  const [deleting, setDeleting] = useState<K8sObject | null>(null);
  const current = kinds.find((entry) => entry.kind === kind)!;
  const queryNamespace = current.namespaced && namespace.trim() ? namespace.trim() : undefined;
  const objectsQuery = useRbacObjects(kind, queryNamespace);
  const create = useCreateRbacObject();
  const update = useUpdateRbacObject();
  const remove = useDeleteRbacObject();
  const busy = create.isPending || update.isPending;
  const allObjects = objectsQuery.data?.items ?? [];
  const rows = useMemo(() => allObjects.filter((item) => `${objectName(item)} ${objectNamespace(item)} ${summary(item)}`.toLowerCase().includes(search.toLowerCase())), [allObjects, search]);
  const problem = objectsQuery.error;

  const save = () => {
    if (!editor) return;
    if (editor.mode === 'create') create.mutate({ kind, yaml: editor.yaml }, { onSuccess: () => setEditor(null) });
    else if (editor.item) update.mutate({ kind, name: objectName(editor.item), namespace: editor.item.metadata?.namespace, yaml: editor.yaml }, { onSuccess: () => setEditor(null) });
  };
  const edit = (item: K8sObject) => setEditor({ mode: 'edit', item, yaml: toYaml(cleanForEdit(item)) });

  return <>
    <PageHeader title="RBAC roles and bindings" subtitle="Create, inspect, edit, and remove Kubernetes roles and role bindings using your authenticated cluster identity."
      actions={<button className="btn" onClick={() => void objectsQuery.refetch()} disabled={objectsQuery.isFetching}><RefreshCw size={14} className={objectsQuery.isFetching ? 'spin' : ''} />Refresh</button>} />
    <div className="rbac-manager-tabs" role="tablist" aria-label="RBAC resource type">
      {kinds.map((entry) => <button key={entry.kind} role="tab" aria-selected={kind === entry.kind} className={`btn ${kind === entry.kind ? 'btn--primary' : ''}`} onClick={() => { setKind(entry.kind); setSearch(''); }}>{entry.label}</button>)}
    </div>
    <div className="toolbar rbac-manager-toolbar">
      <SearchInput value={search} onChange={setSearch} placeholder={`Search ${current.label.toLowerCase()}…`} />
      {current.namespaced && <Field label="Namespace"><input value={namespace} onChange={(event) => setNamespace(event.target.value)} placeholder="All namespaces" /></Field>}
      <button className="btn btn--primary" onClick={() => setEditor({ mode: 'create', yaml: blankManifest(kind, namespace.trim()) })}><FilePlus2 size={15} />Create {current.kind}</button>
    </div>
    {problem && <div className="callout callout--danger">{messageOf(problem)}</div>}
    <DataTable
      columns={columns(current.namespaced, edit, setDeleting)}
      rows={rows}
      rowKey={(item) => `${item.metadata?.namespace ?? ''}/${objectName(item)}`}
      loading={objectsQuery.isPending || objectsQuery.isFetching && !objectsQuery.data}
      loadingTitle={`Loading ${current.label} from Kubernetes…`}
      empty={<EmptyState icon={<UsersRound size={20} />} title={`No ${current.label} found`} detail={current.namespaced && !queryNamespace ? 'Enter a namespace to narrow the list, or create a role or binding.' : `Create a ${current.kind} to manage access in this cluster.`} />}
      footer={<span>{rows.length} {current.label.toLowerCase()}</span>}
    />
    {editor && <ManifestEditorDialog
      kicker="KUBERNETES RBAC"
      title={`${editor.mode === 'create' ? 'Create' : 'Edit'} ${current.kind}`}
      description="Review the manifest carefully. Role bindings grant the permissions in their referenced role to every listed subject."
      value={editor.yaml}
      onChange={(yaml) => setEditor({ ...editor, yaml })}
      busy={busy}
      submitLabel={editor.mode === 'create' ? 'Create object' : 'Save changes'}
      onSubmit={save}
      onClose={() => setEditor(null)}
      serverError={create.error ? messageOf(create.error) : update.error ? messageOf(update.error) : null}
      hint="The Kubernetes API validates permissions and scope when you save."
    />}
    {deleting && <ConfirmDialog
      title={`Delete ${kind}/${objectName(deleting)}?`}
      description={<>This permanently removes the {kind} from the cluster{deleting.metadata?.namespace ? <> in namespace <b>{deleting.metadata.namespace}</b></> : ''}. Any access granted through this object will stop.</>}
      confirmLabel="Delete object"
      danger
      busy={remove.isPending}
      onCancel={() => setDeleting(null)}
      onConfirm={() => remove.mutate({ kind, name: objectName(deleting), namespace: deleting.metadata?.namespace }, { onSettled: () => setDeleting(null) })}
    />}
  </>;
}
