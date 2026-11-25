import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp, type AppOptions } from 'firebase-admin/app';
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

export function resolveFirebaseProjectId(): string | undefined {
  const envProjectId = stripQuotes(
    process.env.FIREBASE_PROJECT_ID ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT,
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

  return undefined;
}

function buildFirebaseAdminOptions(): AppOptions | undefined {
  const projectId = resolveFirebaseProjectId();
  const clientEmail = stripQuotes(process.env.FIREBASE_CLIENT_EMAIL);
  const rawPrivateKey = stripQuotes(process.env.FIREBASE_PRIVATE_KEY);
  const normalizedPrivateKey = rawPrivateKey.replace(/\\n/g, '\n');

  const hasUsableServiceAccount =
    Boolean(projectId) &&
    clientEmail.includes('@') &&
    !clientEmail.toLowerCase().includes('placeholder') &&
    normalizedPrivateKey.includes('BEGIN PRIVATE KEY') &&
    !normalizedPrivateKey.includes('REPLACE_WITH') &&
    !normalizedPrivateKey.includes('placeholder');

  if (hasUsableServiceAccount) {
    try {
      return {
        projectId,
        credential: cert({
          projectId,
          clientEmail,
          privateKey: normalizedPrivateKey,
        }),
      };
    } catch {
      // Fall back to projectId-only mode for public-key ID token verification
    }
  }

  return projectId ? { projectId } : undefined;
}

if (!getApps().length) {
  initializeApp(buildFirebaseAdminOptions());
}

export const adminAuth = getAuth();
