import { useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { RefreshCw, RotateCw } from 'lucide-react';
import { useCluster, useRestartKro } from '../api/hooks';
import { ConfirmDialog } from '../components/ConfirmDialog';

const SECTIONS: Record<string, string> = { graphs: 'Resource graphs', instances: 'Instances', apis: 'API catalog', rbac: 'RBAC advisor' };

function useBreadcrumbs() {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return [{ label: 'Overview' }];
  const section = { label: SECTIONS[parts[0]] ?? parts[0], to: `/${parts[0]}` };
  if (parts.length === 1) return [section];
  return [section, { label: parts[parts.length - 1] }];
}

export function Topbar() {
  const crumbs = useBreadcrumbs();
  const { connected, connection, kroReady } = useCluster();
  const queryClient = useQueryClient();
  const fetching = useIsFetching() > 0;
  const restart = useRestartKro();
  const [confirmRestart, setConfirmRestart] = useState(false);

  return (
    <header className="topbar">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <span>Workspace</span>
        {crumbs.map((crumb, index) => (
          <span key={index} className="breadcrumbs__item">
            <span className="breadcrumbs__sep">/</span>
            {'to' in crumb && crumb.to && index < crumbs.length - 1 ? <Link to={crumb.to}>{crumb.label}</Link> : <b>{crumb.label}</b>}
          </span>
        ))}
      </nav>
      <div className="topbar__actions">
        <div className="connection-indicator" title={connection?.message}><span className={`dot dot--${connected ? 'green' : 'amber'}`} />{connected ? 'Cluster connected' : 'Cluster disconnected'}</div>
        {kroReady && <button className="btn btn--sm" onClick={() => setConfirmRestart(true)}><RotateCw size={14} />Restart controller</button>}
        <button className="icon-btn" aria-label="Refresh data" title="Refresh all data" onClick={() => void queryClient.invalidateQueries()}><RefreshCw size={16} className={fetching ? 'spin' : ''} /></button>
      </div>
      {confirmRestart && (
        <ConfirmDialog
          title="Restart the KRO controller?"
          description="This starts a rolling restart of the controller in kro-system. Reconciliation resumes when it is ready."
          confirmLabel="Restart controller"
          busy={restart.isPending}
          onCancel={() => setConfirmRestart(false)}
          onConfirm={() => restart.mutate(undefined, { onSettled: () => setConfirmRestart(false) })}
        />
      )}
    </header>
  );
}
