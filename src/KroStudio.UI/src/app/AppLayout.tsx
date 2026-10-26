import { Outlet, ScrollRestoration } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Footer } from './Footer';
import { ClusterBanners } from '../features/cluster/ClusterBanners';

export function AppLayout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-area">
        <Topbar />
        <main className="content-wrap">
          <ClusterBanners />
          <Outlet />
        </main>
        <Footer />
      </div>
      <ScrollRestoration />
    </div>
  );
}
