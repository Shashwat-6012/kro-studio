import { ExternalLink } from 'lucide-react';
import { useCluster } from '../api/hooks';

export function Footer() {
  const { connected } = useCluster();
  return (
    <footer className="page-footer">
      <span>KRO Studio · v0.2.0</span>
      <span className="page-footer__links">
        <span><span className={`dot dot--${connected ? 'green' : 'amber'} dot--small`} />{connected ? 'Connected' : 'Waiting for cluster'}</span>
        <a href="https://kro.run/docs/" target="_blank" rel="noreferrer">Documentation <ExternalLink size={12} /></a>
      </span>
    </footer>
  );
}
