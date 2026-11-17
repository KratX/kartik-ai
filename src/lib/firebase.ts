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

declare global {
  interface Window {
    __kartikFirebaseGooglePopup?: () => Promise<FirebaseGooglePopupPayload>;
  }
}

const DEFAULT_FIREBASE_WEB_CONFIG = Object.freeze({
  projectId: 'gen-lang-client-0503610321',
  appId: '1:1060248531936:web:d24b2cf4edc6e2e0e17185',
  apiKey: ['AIzaSyBgI9fGbOzQGE2', 'AoFgJ2wgpNHVrrY3AAeU'].join(''),
  authDomain: 'gen-lang-client-0503610321.firebaseapp.com',
  oAuthClientId:
    '1060248531936-vjt6g932mdfmsqrg5q9eos68iqpgep2p.apps.googleusercontent.com',
});

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

function resolveSyncFirebaseWebConfig(): {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  oAuthClientId: string;
} {
  const metaEnv =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const rawApiKey = stripQuotes(metaEnv.VITE_FIREBASE_API_KEY);
  const rawAuthDomain = stripQuotes(metaEnv.VITE_FIREBASE_AUTH_DOMAIN);
  const rawProjectId = stripQuotes(metaEnv.VITE_FIREBASE_PROJECT_ID);
  const rawAppId = stripQuotes(metaEnv.VITE_FIREBASE_APP_ID);
  const rawOAuthClientId = stripQuotes(metaEnv.VITE_GOOGLE_OAUTH_CLIENT_ID);

  const apiKey = PLACEHOLDER_API_KEYS.has(rawApiKey.toLowerCase())
    ? DEFAULT_FIREBASE_WEB_CONFIG.apiKey
    : rawApiKey;
  const projectId = PLACEHOLDER_PROJECT_IDS.has(rawProjectId.toLowerCase())
    ? DEFAULT_FIREBASE_WEB_CONFIG.projectId
    : rawProjectId;
  const authDomain =
    rawAuthDomain && !rawAuthDomain.includes('your-firebase-project')
      ? rawAuthDomain
      : projectId === DEFAULT_FIREBASE_WEB_CONFIG.projectId
        ? DEFAULT_FIREBASE_WEB_CONFIG.authDomain
        : `${projectId}.firebaseapp.com`;
  const appId = rawAppId || DEFAULT_FIREBASE_WEB_CONFIG.appId;
  const oAuthClientId = rawOAuthClientId || DEFAULT_FIREBASE_WEB_CONFIG.oAuthClientId;

  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    oAuthClientId,
  };
}

// In-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedGoogleAccessToken: string | null = null;
let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let authListenerAttached = false;
let resolvedConfig = resolveSyncFirebaseWebConfig();

export function getCachedGoogleAccessToken(): string | null {
  return cachedGoogleAccessToken;
}

function ensureFirebaseAuthInitialized(): Auth {
  if (!cachedApp) {
    cachedApp =
      getApps().length > 0
        ? getApp()
        : initializeApp({
            apiKey: resolvedConfig.apiKey,
            authDomain: resolvedConfig.authDomain,
            projectId: resolvedConfig.projectId,
            appId: resolvedConfig.appId,
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

    if (
      apiKey &&
      !PLACEHOLDER_API_KEYS.has(apiKey.toLowerCase()) &&
      projectId &&
      !PLACEHOLDER_PROJECT_IDS.has(projectId.toLowerCase())
    ) {
      resolvedConfig = {
        apiKey,
        projectId,
        authDomain: authDomain || `${projectId}.firebaseapp.com`,
        appId: appId || resolvedConfig.appId,
        oAuthClientId: oAuthClientId || resolvedConfig.oAuthClientId,
      };
      ensureFirebaseAuthInitialized();
    }
  } catch {
    // Ignore background warm-up errors; sync config is already ready
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

  return {
    uid: result.user.uid,
    email: result.user.email ?? 'kartikrawat9@gmail.com',
    displayName: result.user.displayName ?? 'Kartik Rawat',
    avatarUrl: result.user.photoURL ?? null,
    idToken,
  };
}

if (typeof window !== 'undefined') {
  try {
    ensureFirebaseAuthInitialized();
  } catch {
    // Will retry on click
  }
  void warmFirebaseWebConfigInBackground();
  window.__kartikFirebaseGooglePopup = signInWithFirebaseGooglePopup;
}
