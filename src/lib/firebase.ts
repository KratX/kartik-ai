import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type Auth,
} from 'firebase/auth';

export const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export interface FirebaseGooglePopupPayload {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly idToken: string;
}

interface RuntimeFirebaseWebConfig {
  readonly brandName?: string;
  readonly apiKey?: string;
  readonly authDomain?: string;
  readonly projectId?: string;
  readonly appId?: string;
  readonly oAuthClientId?: string;
  readonly enabled?: boolean;
}

interface ResolvedFirebaseWebConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly appId: string;
  readonly oAuthClientId: string;
}

declare global {
  interface Window {
    __kartikFirebaseGooglePopup?: () => Promise<FirebaseGooglePopupPayload>;
  }
}

const PLACEHOLDER_API_KEYS = new Set([
  '',
  'your_firebase_web_api_key',
  'demo-firebase-api-key',
  'replace_me',
  'changeme',
]);

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

function isUsableFirebaseWebConfig(cfg: ResolvedFirebaseWebConfig | null): cfg is ResolvedFirebaseWebConfig {
  return Boolean(
    cfg &&
      cfg.apiKey &&
      !PLACEHOLDER_API_KEYS.has(cfg.apiKey.toLowerCase()) &&
      cfg.projectId &&
      !PLACEHOLDER_PROJECT_IDS.has(cfg.projectId.toLowerCase()),
  );
}

function resolveSyncFirebaseWebConfig(): ResolvedFirebaseWebConfig | null {
  const metaEnv =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const apiKey = stripQuotes(metaEnv.VITE_FIREBASE_API_KEY);
  const authDomain = stripQuotes(metaEnv.VITE_FIREBASE_AUTH_DOMAIN);
  const projectId = stripQuotes(metaEnv.VITE_FIREBASE_PROJECT_ID);
  const appId = stripQuotes(metaEnv.VITE_FIREBASE_APP_ID);
  const oAuthClientId = stripQuotes(metaEnv.VITE_GOOGLE_OAUTH_CLIENT_ID);

  if (
    PLACEHOLDER_API_KEYS.has(apiKey.toLowerCase()) ||
    PLACEHOLDER_PROJECT_IDS.has(projectId.toLowerCase())
  ) {
    return null;
  }

  return {
    apiKey,
    projectId,
    authDomain:
      authDomain && !authDomain.includes('your-firebase-project')
        ? authDomain
        : `${projectId}.firebaseapp.com`,
    appId,
    oAuthClientId,
  };
}

// In-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedGoogleAccessToken: string | null = null;
let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let authListenerAttached = false;
let resolvedConfig: ResolvedFirebaseWebConfig | null = resolveSyncFirebaseWebConfig();

export function getCachedGoogleAccessToken(): string | null {
  return cachedGoogleAccessToken;
}

function ensureFirebaseAuthInitialized(): Auth {
  if (!isUsableFirebaseWebConfig(resolvedConfig)) {
    throw new Error(
      'Firebase Web Auth is not configured. Set VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID in .env (or provide server Firebase config).',
    );
  }
  if (!cachedApp) {
    cachedApp =
      getApps().length > 0
        ? getApp()
        : initializeApp({
            apiKey: resolvedConfig.apiKey,
            authDomain: resolvedConfig.authDomain,
            projectId: resolvedConfig.projectId,
            ...(resolvedConfig.appId ? { appId: resolvedConfig.appId } : {}),
          });
  }
  if (!cachedAuth) {
    cachedAuth = getAuth(cachedApp);
  }
  if (!authListenerAttached) {
    authListenerAttached = true;
    onAuthStateChanged(cachedAuth, (user) => {
      if (!user) {
        cachedGoogleAccessToken = null;
      }
    });
  }
  return cachedAuth;
}

async function warmFirebaseWebConfigInBackground(): Promise<void> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return;
  }
  try {
    const res = await fetch('/api/v1/auth/firebase-config', {
      credentials: 'include',
    });
    if (!res.ok) {
      return;
    }
    const json = (await res.json()) as {
      readonly ok?: boolean;
      readonly data?: RuntimeFirebaseWebConfig;
    };
    const data = json.data;
    if (!data) {
      return;
    }
    const apiKey = stripQuotes(data.apiKey);
    const projectId = stripQuotes(data.projectId);
    const authDomain = stripQuotes(data.authDomain);
    const appId = stripQuotes(data.appId);
    const oAuthClientId = stripQuotes(data.oAuthClientId);
    const candidate: ResolvedFirebaseWebConfig = {
      apiKey,
      projectId,
      authDomain: authDomain || `${projectId}.firebaseapp.com`,
      appId,
      oAuthClientId,
    };
    if (isUsableFirebaseWebConfig(candidate)) {
      resolvedConfig = candidate;
      ensureFirebaseAuthInitialized();
    }
  } catch {
    // Ignore background warm-up errors; env config will be used if available
  }
}

/**
 * Triggers the Firebase Google OAuth popup synchronously within the user's click gesture
 * so browsers never block the popup due to pre-popup network `await` calls.
 */
export async function signInWithFirebaseGooglePopup(): Promise<FirebaseGooglePopupPayload> {
  const auth = ensureFirebaseAuthInitialized();
  const provider = new GoogleAuthProvider();
  for (const scope of SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  const oauthCred = GoogleAuthProvider.credentialFromResult(result);
  cachedGoogleAccessToken = oauthCred?.accessToken ?? null;
  const idToken = await result.user.getIdToken();
  const email = result.user.email ?? '';
  const displayName =
    result.user.displayName ?? (email.split('@')[0] || 'Google User');
  return {
    uid: result.user.uid,
    email,
    displayName,
    avatarUrl: result.user.photoURL ?? null,
    idToken,
  };
}

if (typeof window !== 'undefined') {
  if (isUsableFirebaseWebConfig(resolvedConfig)) {
    try {
      ensureFirebaseAuthInitialized();
    } catch {
      // Will retry after runtime config warm-up or on click
    }
  }
  void warmFirebaseWebConfigInBackground();
  window.__kartikFirebaseGooglePopup = signInWithFirebaseGooglePopup;
}
