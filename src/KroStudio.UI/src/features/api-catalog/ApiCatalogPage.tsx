import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Database } from 'lucide-react';
import { useApiCatalog } from '../../api/hooks';
import type { GeneratedApi } from '../../api/types';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { SearchInput } from '../../components/SearchInput';

const columns: Column<GeneratedApi>[] = [
  { key: 'kind', header: 'Kind', width: '1.25fr', render: (api) => <span className="name-cell"><span className="icon-tile"><Database size={16} /></span><span><b>{api.kind}</b></span></span> },
  { key: 'group', header: 'API group / version', width: '1.5fr', render: (api) => <span className="muted-text">{api.group}/{api.version}</span> },
  { key: 'plural', header: 'Resource', width: '1.1fr', hideOnSmall: true, render: (api) => <code>{api.plural}</code> },
  { key: 'scope', header: 'Scope', width: '.8fr', hideOnSmall: true, render: (api) => <span className="muted-text">{api.namespaced ? 'Namespaced' : 'Cluster'}</span> },
  { key: 'go', header: '', width: '24px', align: 'right', render: () => <ArrowRight size={16} className="row-arrow" /> },
];

export function ApiCatalogPage() {
  const navigate = useNavigate();
  const { apis, isLoading } = useApiCatalog();
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => apis.filter((api) => `${api.kind} ${api.group} ${api.plural}`.toLowerCase().includes(search.toLowerCase())), [apis, search]);

  return (
    <>
      <PageHeader title="API catalog" subtitle="Generated APIs discovered from your resource graph definitions." />
      <div className="toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Search APIs…" /></div>
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(api) => api.id}
        loading={isLoading}
        loadingTitle="Checking each resource graph against Kubernetes API discovery…"
        onRowClick={(api) => navigate(`/apis/${encodeURIComponent(api.id)}`)}
        empty={<EmptyState icon={<Database size={20} />} title="No generated APIs discovered" detail="A ready resource graph with a served custom resource API will appear here." />}
        footer={<span>{filtered.length} generated {filtered.length === 1 ? 'API' : 'APIs'}</span>}
      />
    </>
  );
}
