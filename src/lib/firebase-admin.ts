import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function resolveFirebaseProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }
  if (process.env.VITE_FIREBASE_PROJECT_ID) {
    return process.env.VITE_FIREBASE_PROJECT_ID;
  }
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        projectId?: string;
      };
      if (parsed.projectId) {
        return parsed.projectId;
      }
    } catch {
      // Ignore malformed optional local config
    }
  }
  return 'kartik-ai-local';
}

if (!getApps().length) {
  initializeApp({
    projectId: resolveFirebaseProjectId(),
  });
}

export const adminAuth = getAuth();
