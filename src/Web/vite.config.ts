import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = {
  target: 'http://127.0.0.1:8080',
  changeOrigin: false, // keep Host as localhost:5173
  xfwd: true,          // send X-Forwarded-Host/Proto/For
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/auth': backend,
      '/signin-oidc': backend,
      '/signout-callback-oidc': backend,
    },
  },
});