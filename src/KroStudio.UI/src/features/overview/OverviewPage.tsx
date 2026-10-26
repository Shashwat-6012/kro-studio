import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Box, GitBranch, Layers3, Plus, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useApiCatalog, useCluster, useDefinitions } from '../../api/hooks';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { toneOf } from '../../lib/status';
import { definitionColumns } from '../resource-graphs/ResourceGraphsPage';

function Stat({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <div className="stat-card"><div className={`stat-card__icon stat-card__icon--${tone}`}>{icon}</div><span className="stat-card__label">{label}</span><div className="stat-card__value">{value}</div><div className="stat-card__detail">{detail}</div></div>;
}

export function OverviewPage() {
  const navigate = useNavigate();
  const { capabilities, kroReady } = useCluster();
  const { data: definitions = [], isPending } = useDefinitions();
  const { apis } = useApiCatalog();
  const loading = isPending && kroReady;
  const ready = definitions.filter((d) => toneOf(d.readiness) === 'success').length;
  const attention = definitions.filter((d) => toneOf(d.readiness) !== 'success');
  const pad = (n: number) => (loading ? '—' : String(n).padStart(2, '0'));

  return (
    <>
      <PageHeader title="Workspace overview" subtitle="Live health and resources from your Kubernetes cluster." actions={<button className="btn btn--primary" onClick={() => navigate('/graphs?create=1')}><Plus size={16} />Create resource graph</button>} />
      <section className="stats-grid">
        <Stat tone="blue" icon={<GitBranch size={17} />} label="Resource graphs" value={pad(definitions.length)} detail="Cluster-scoped definitions" />
        <Stat tone="green" icon={<ShieldCheck size={17} />} label="Ready" value={pad(ready)} detail="Accepted by KRO" />
        <Stat tone="violet" icon={<Box size={17} />} label="Generated APIs" value={pad(apis.length)} detail="Discoverable custom APIs" />
        <Stat tone="amber" icon={<Layers3 size={17} />} label="KRO API" value={loading ? '—' : capabilities?.kroApiAvailable ? 'Detected' : 'Unavailable'} detail={capabilities?.message ?? 'ResourceGraphDefinition API'} />
      </section>

      {attention.length > 0 && (
        <section className="card card--attention">
          <div className="card__heading"><div><h2><AlertTriangle size={15} /> Needs attention</h2><p>Resource graphs that are not ready yet.</p></div></div>
          <div className="list">
            {attention.slice(0, 5).map((item) => (
              <Link className="list-row list-row--link" key={item.name} to={`/graphs/${encodeURIComponent(item.name)}`}>
                <span className="icon-tile"><GitBranch size={16} /></span>
                <div><b>{item.name}</b><small>{item.generatedKind ?? 'API pending'}</small></div>
                <StatusBadge status={item.readiness} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="section-row"><div><h2>Resource graphs</h2><p>Most recent definitions in the cluster.</p></div><Link className="link-btn" to="/graphs">Open catalog <ArrowRight size={14} /></Link></div>
      <DataTable
        columns={definitionColumns}
        rows={definitions.slice(0, 5)}
        rowKey={(item) => item.name}
        loading={loading}
        loadingTitle="Loading cluster resources…"
        onRowClick={(item) => navigate(`/graphs/${encodeURIComponent(item.name)}`)}
        empty={<EmptyState icon={<GitBranch size={20} />} title="No resource graphs yet" detail="Create a definition to generate a reusable Kubernetes API." action={<button className="link-btn" onClick={() => navigate('/graphs?create=1')}>Create resource graph <ArrowRight size={14} /></button>} />}
      />

      <section className="quick-card">
        <div><h3>Manage generated instances</h3><p>Browse, inspect, and remove the resources KRO creates — and see how each instance is composed.</p></div>
        <Link className="btn btn--on-dark" to="/instances">Open instances <ArrowRight size={15} /></Link>
      </section>
    </>
  );
}
