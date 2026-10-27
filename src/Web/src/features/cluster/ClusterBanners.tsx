import { useState } from 'react';
import { ArrowRight, ExternalLink, Layers3, PlugZap, ShieldCheck } from 'lucide-react';
import { useCluster, useInstallKro } from '../../api/hooks';
import { Modal } from '../../components/Modal';

export function ClusterBanners() {
  const { connection, capabilities, installation, connected, loading } = useCluster();
  const install = useInstallKro();
  const [open, setOpen] = useState(false);
  const version = installation ? `v${installation.version}` : '';

  if (loading) return null;
  if (!connected) {
    return (
      <section className="banner banner--warning">
        <div className="banner__icon"><PlugZap size={17} /></div>
        <div className="banner__copy"><b>No cluster connection</b><p>{connection?.message ?? 'Check your kubeconfig and that the API is running.'}</p></div>
      </section>
    );
  }
  if (!capabilities?.clusterApiAvailable || capabilities.kroApiAvailable) return null;

  return (
    <>
      <section className="banner banner--info">
        <div className="banner__icon"><Layers3 size={17} /></div>
        <div className="banner__copy"><b>KRO isn’t installed in this cluster</b><p>Install KRO {version} to create and manage resource graphs.</p></div>
        <a className="banner__link" href={installation?.documentationUrl ?? 'https://kro.run/docs/getting-started/Installation/'} target="_blank" rel="noreferrer">Install details <ExternalLink size={13} /></a>
        <button className="btn btn--primary" onClick={() => setOpen(true)}>Install KRO <ArrowRight size={15} /></button>
      </section>
      {open && (
        <Modal
          title={`Install KRO ${version}?`}
          kicker="Cluster installation"
          description="This applies the official KRO release manifest to the connected cluster."
          width={510}
          busy={install.isPending}
          onClose={() => setOpen(false)}
          footer={<>
            <button className="btn" onClick={() => setOpen(false)} disabled={install.isPending}>Cancel</button>
            <button className="btn btn--primary" disabled={install.isPending} onClick={() => install.mutate(undefined, { onSuccess: () => setOpen(false) })}><Layers3 size={15} />{install.isPending ? 'Installing…' : 'Install KRO'}</button>
          </>}
        >
          <div className="callout callout--warning"><ShieldCheck size={16} /><span>Creates the KRO controller, CRDs, and cluster-wide access roles in the <b>kro-system</b> namespace. Your Kubernetes credentials need permission to create cluster-scoped resources.</span></div>
        </Modal>
      )}
    </>
  );
}
