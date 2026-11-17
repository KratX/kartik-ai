import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');

function loadOptionalFirebaseAppletEnv(): Record<string, string> {
  const configPath = path.resolve(repoRoot, 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<
      string,
      string | undefined
    >;
    const defs: Record<string, string> = {};
    if (!process.env.VITE_FIREBASE_API_KEY && raw.apiKey) {
      defs['import.meta.env.VITE_FIREBASE_API_KEY'] = JSON.stringify(raw.apiKey);
    }
    if (!process.env.VITE_FIREBASE_AUTH_DOMAIN && raw.authDomain) {
      defs['import.meta.env.VITE_FIREBASE_AUTH_DOMAIN'] = JSON.stringify(
        raw.authDomain,
      );
    }
    if (!process.env.VITE_FIREBASE_PROJECT_ID && raw.projectId) {
      defs['import.meta.env.VITE_FIREBASE_PROJECT_ID'] = JSON.stringify(
        raw.projectId,
      );
    }
    if (!process.env.VITE_FIREBASE_APP_ID && raw.appId) {
      defs['import.meta.env.VITE_FIREBASE_APP_ID'] = JSON.stringify(raw.appId);
    }
    if (!process.env.VITE_GOOGLE_OAUTH_CLIENT_ID && raw.oAuthClientId) {
      defs['import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID'] = JSON.stringify(
        raw.oAuthClientId,
      );
    }
    return defs;
  } catch {
    return {};
  }
}

export default defineConfig({
  root: currentDir,
  envDir: repoRoot,
  publicDir: path.resolve(currentDir, '../public'),
  plugins: [react(), tailwindcss()],
  define: loadOptionalFirebaseAppletEnv(),
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
