import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const PLACEHOLDER_PROJECT_IDS = new Set([
  '',
  'your-firebase-project',
  'kartik-mock-project',
  'demo-project',
  'replace_me',
  'changeme',
]);

function stripQuotes(value?: string): string {
  return (value ?? '').trim().replace(/^["']|["']$/g, '');
}

export function resolveFirebaseProjectId(): string {
  const envProjectId = stripQuotes(
    process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
  );
  if (envProjectId && !PLACEHOLDER_PROJECT_IDS.has(envProjectId.toLowerCase())) {
    return envProjectId;
  }
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        projectId?: string;
      };
      const fileProjectId = stripQuotes(parsed.projectId);
      if (fileProjectId && !PLACEHOLDER_PROJECT_IDS.has(fileProjectId.toLowerCase())) {
        return fileProjectId;
      }
    } catch {
      // Ignore malformed optional local config
    }
  }
  return 'gen-lang-client-0503610321';
}

if (!getApps().length) {
  initializeApp({
    projectId: resolveFirebaseProjectId(),
  });
}

export const adminAuth = getAuth();
