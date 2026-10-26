import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { OverviewPage } from '../features/overview/OverviewPage';
import { ResourceGraphsPage } from '../features/resource-graphs/ResourceGraphsPage';
import { ResourceGraphDetailPage } from '../features/resource-graphs/ResourceGraphDetailPage';
import { InstancesPage } from '../features/instances/InstancesPage';
import { InstanceDetailPage } from '../features/instances/InstanceDetailPage';
import { ApiCatalogPage } from '../features/api-catalog/ApiCatalogPage';
import { ApiDetailPage } from '../features/api-catalog/ApiDetailPage';
import { RbacAdvisorPage } from '../features/rbac/RbacAdvisorPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'graphs', element: <ResourceGraphsPage /> },
      { path: 'graphs/:name', element: <ResourceGraphDetailPage /> },
      { path: 'instances', element: <InstancesPage /> },
      { path: 'instances/:graph/:name', element: <InstanceDetailPage /> },
      { path: 'apis', element: <ApiCatalogPage /> },
      { path: 'apis/:apiId', element: <ApiDetailPage /> },
      { path: 'rbac', element: <RbacAdvisorPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
