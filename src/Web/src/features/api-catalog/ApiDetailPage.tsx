import { Link, useParams } from 'react-router-dom';
import { Database } from 'lucide-react';
import { useApiCatalog, useDefinitionManifest } from '../../api/hooks';
import { BackLink } from '../../components/BackLink';
import { CodePanel } from '../../components/CodePanel';
import { EmptyState, LoadingState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';

export function ApiDetailPage() {
  const { apiId = '' } = useParams();
  const { apis, isLoading } = useApiCatalog();
  const api = apis.find((entry) => entry.id === apiId);
  const { data: manifest } = useDefinitionManifest(api?.definitionName);

  if (isLoading) return <LoadingState title="Discovering generated APIs…" />;
  if (!api) return <><BackLink to="/apis" label="API catalog" current={apiId} /><EmptyState icon={<Database size={20} />} title="API not found" detail="It may have been removed along with its resource graph." action={<Link className="link-btn" to="/apis">Back to API catalog</Link>} /></>;

  return (
    <>
      <BackLink to="/apis" label="API catalog" current={api.kind} />
      <PageHeader title={api.kind} subtitle={`${api.group}/${api.version} · ${api.plural}`} actions={api.definitionName ? <Link className="btn btn--primary" to={`/instances?graph=${encodeURIComponent(api.definitionName)}`}>Browse instances</Link> : undefined} />
      <div className="stat-strip">
        <div><span>Resource</span><b>{api.plural}</b></div>
        <div><span>Scope</span><b>{api.namespaced ? 'Namespaced' : 'Cluster'}</b></div>
        <div><span>Resource graph</span><b>{api.definitionName ? <Link to={`/graphs/${encodeURIComponent(api.definitionName)}`}>{api.definitionName}</Link> : '—'}</b></div>
        <div><span>API version</span><b>{api.version}</b></div>
      </div>
      <div className="two-col">
        <CodePanel title="OpenAPI schema" value={api.schema} empty="Kubernetes did not return an OpenAPI schema for this API." />
        <CodePanel title="Resource graph schema" value={manifest?.spec?.schema} empty="The resource graph definition is unavailable." />
      </div>
    </>
  );
}
