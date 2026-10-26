import { NavLink, Link } from 'react-router-dom';
import { Box, CircleHelp, Database, ExternalLink, FileCode2, GitBranch, LayoutDashboard, Layers3, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCluster, useDefinitions } from '../api/hooks';

function NavItem({ to, icon, label, count, end }: { to: string; icon: ReactNode; label: string; count?: number; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`} title={label}>
      {icon}<span className="nav-item__label">{label}</span>{count !== undefined && <span className="nav-item__count">{count}</span>}
    </NavLink>
  );
}

export function Sidebar() {
  const { connection, connected } = useCluster();
  const { data: definitions } = useDefinitions();
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand__mark"><Layers3 size={19} /></div>
        <div className="brand__text"><strong>kro<span>studio</span></strong><small>Platform workspace</small></div>
      </div>
      <div className="cluster-card" title={connection?.message}>
        <span className={`dot dot--${connected ? 'green' : 'amber'}`} />
        <span className="cluster-card__text"><b>{connection?.context ?? 'Local cluster'}</b><small>{connection?.kubernetesVersion ?? (connected ? 'Connected' : 'No context connected')}</small></span>
      </div>
      <div className="side-label">Workspace</div>
      <nav className="nav">
        <NavItem to="/" end icon={<LayoutDashboard size={17} />} label="Overview" />
        <NavItem to="/graphs" icon={<GitBranch size={17} />} label="Resource graphs" count={definitions?.length} />
        <NavItem to="/instances" icon={<Box size={17} />} label="Instances" />
        <NavItem to="/apis" icon={<Database size={17} />} label="API catalog" />
        <NavItem to="/rbac" icon={<ShieldCheck size={17} />} label="RBAC advisor" />
      </nav>
      <div className="side-label side-label--spaced">Tools</div>
      <nav className="nav">
        <Link className="nav-item" to="/graphs?create=1" title="YAML playground"><FileCode2 size={17} /><span className="nav-item__label">YAML playground</span></Link>
      </nav>
      <div className="sidebar__bottom">
        <a className="help-card" href="https://kro.run/docs/" target="_blank" rel="noreferrer">
          <span className="help-card__icon"><CircleHelp size={17} /></span>
          <span><b>KRO documentation</b><small>Guides and concepts</small></span>
          <ExternalLink size={14} />
        </a>
        <div className="user-row"><div className="avatar">KS</div><div><b>Local operator</b><small>Personal workspace</small></div></div>
      </div>
    </aside>
  );
}
