import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 3000,
    proxy: {
      '/api/backend': {
        target: process.env.VITE_API_URL ?? 'http://localhost:4000',
        rewrite: (p) => p.replace(/^\/api\/backend/, ''),
        changeOrigin: true,
      },
      '/api/incidents': {
        target: process.env.VITE_INCIDENT_URL ?? 'http://localhost:5000',
        rewrite: (p) => p.replace(/^\/api\/incidents/, '/api/incidents'),
        changeOrigin: true,
      },
    },
  },
});
