import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: currentDir,
  publicDir: path.resolve(currentDir, '../public'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(currentDir, './src'),
      '@kartik/shared': path.resolve(currentDir, '../backend/shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_GATEWAY_ORIGIN ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/healthz': {
        target: process.env.VITE_GATEWAY_ORIGIN ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/readyz': {
        target: process.env.VITE_GATEWAY_ORIGIN ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(currentDir, 'dist'),
    emptyOutDir: false,
    sourcemap: true,
  },
});
