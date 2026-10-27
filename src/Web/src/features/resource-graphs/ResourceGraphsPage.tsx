import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, GitBranch, Plus } from 'lucide-react';
import { useDefinitions } from '../../api/hooks';
import type { Definition } from '../../api/types';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { FilterChips } from '../../components/FilterChips';
import { PageHeader } from '../../components/PageHeader';
import { SearchInput } from '../../components/SearchInput';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDate } from '../../lib/format';
import { toneOf } from '../../lib/status';
import { starterYaml } from '../../lib/templates';
import { RgdEditorDialog } from './RgdEditorDialog';

type StatusFilter = 'all' | 'success' | 'warning' | 'danger';

export const definitionColumns: Column<Definition>[] = [
  { key: 'name', header: 'Name', width: '2.1fr', render: (item) => <span className="name-cell"><span className="icon-tile"><GitBranch size={16} /></span><span><b>{item.name}</b><small>{item.kind}</small></span></span> },
  { key: 'api', header: 'Generated API', width: '1.5fr', hideOnSmall: true, render: (item) => item.generatedKind ? <span className="api-cell"><span className="tag">API</span><b>{item.generatedKind}</b></span> : <span className="muted">Discovering…</span> },
  { key: 'status', header: 'Status', width: '1fr', render: (item) => <StatusBadge status={item.readiness} /> },
  { key: 'created', header: 'Created', width: '1fr', hideOnSmall: true, render: (item) => <span className="muted-text">{formatDate(item.createdAt)}</span> },
  { key: 'go', header: '', width: '24px', align: 'right', render: () => <ArrowRight size={16} className="row-arrow" /> },
];

export function ResourceGraphsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: definitions = [], isPending } = useDefinitions();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const creating = params.get('create') === '1';

  const counts = useMemo(() => ({
    all: definitions.length,
    success: definitions.filter((d) => toneOf(d.readiness) === 'success').length,
    warning: definitions.filter((d) => toneOf(d.readiness) === 'warning').length,
    danger: definitions.filter((d) => toneOf(d.readiness) === 'danger').length,
  }), [definitions]);

  const filtered = useMemo(() => definitions.filter((item) =>
    `${item.name} ${item.generatedKind ?? ''}`.toLowerCase().includes(query.toLowerCase()) && (status === 'all' || toneOf(item.readiness) === status)), [definitions, query, status]);

  const openCreate = () => setParams({ create: '1' });
  const closeCreate = () => setParams({});

  return (
    <>
      <PageHeader title="Resource graphs" subtitle="Create and manage the definitions that compose your platform APIs." actions={<button className="btn btn--primary" onClick={openCreate}><Plus size={16} />Create resource graph</button>} />
      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search graphs…" />
        <FilterChips<StatusFilter> active={status} onChange={setStatus} items={[
          { id: 'all', label: 'All', count: counts.all }, { id: 'success', label: 'Ready', count: counts.success },
          { id: 'warning', label: 'Processing', count: counts.warning }, { id: 'danger', label: 'Failed', count: counts.danger },
        ]} />
      </div>
      <DataTable
        columns={definitionColumns}
        rows={filtered}
        rowKey={(item) => item.name}
        loading={isPending}
        loadingTitle="Reading definitions from your cluster…"
        onRowClick={(item) => navigate(`/graphs/${encodeURIComponent(item.name)}`)}
        empty={<EmptyState icon={<GitBranch size={20} />} title={query || status !== 'all' ? 'No matching resource graphs' : 'No resource graphs yet'} detail={query || status !== 'all' ? 'Change the search or status filter.' : 'Create a definition to generate a reusable Kubernetes API.'} action={<button className="link-btn" onClick={openCreate}>Create resource graph <ArrowRight size={14} /></button>} />}
        footer={<span>Showing <b>{filtered.length}</b> of {definitions.length} resource graphs</span>}
      />
      {creating && <RgdEditorDialog mode="create" initialYaml={starterYaml} onClose={closeCreate} />}
    </>
  );
}
