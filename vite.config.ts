import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function loadOptionalFirebaseAppletEnv(): Record<string, string> {
  const configPath = path.resolve(currentDir, 'firebase-applet-config.json');
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

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: loadOptionalFirebaseAppletEnv(),
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(currentDir, '.'),
        '@kartik/shared': path.resolve(currentDir, './backend/shared'),
      },
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'motion/react',
        'lucide-react',
      ],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
