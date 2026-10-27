import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { NamespaceProvider } from './NamespaceProvider';
import { router } from './routes';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 4_000, retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <NamespaceProvider>
          <RouterProvider router={router} />
        </NamespaceProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
