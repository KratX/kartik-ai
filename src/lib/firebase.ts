import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
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

interface GoogleGsiTokenResponse {
  readonly access_token?: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface GoogleGsiTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleAccountsOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    prompt?: string;
    callback: (response: GoogleGsiTokenResponse) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }) => GoogleGsiTokenClient;
}

declare global {
  interface Window {
    __kartikFirebaseGooglePopup?: () => Promise<FirebaseGooglePopupPayload>;
    google?: {
      accounts?: {
        oauth2?: GoogleAccountsOAuth2;
      };
    };
  }
}

function stripQuotes(value?: string): string {
  return (value ?? '').trim().replace(/^["']|["']$/g, '');
}

// In-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedGoogleAccessToken: string | null = null;
let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let authListenerAttached = false;

export function getCachedGoogleAccessToken(): string | null {
  return cachedGoogleAccessToken;
}

async function resolveFirebaseWebConfig(): Promise<{
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  oAuthClientId: string;
}> {
  let apiKey = stripQuotes(String(import.meta.env.VITE_FIREBASE_API_KEY ?? ''));
  let authDomain = stripQuotes(String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? ''));
  let projectId = stripQuotes(String(import.meta.env.VITE_FIREBASE_PROJECT_ID ?? ''));
  let appId = stripQuotes(String(import.meta.env.VITE_FIREBASE_APP_ID ?? ''));
  let oAuthClientId = stripQuotes(
    String(import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? ''),
  );

  try {
    const res = await fetch('/api/v1/auth/firebase-config', {
      credentials: 'include',
    });
    const json = (await res.json()) as {
      readonly ok?: boolean;
      readonly data?: RuntimeFirebaseWebConfig;
    };
    if (json.ok && json.data) {
      apiKey = stripQuotes(json.data.apiKey) || apiKey;
      authDomain = stripQuotes(json.data.authDomain) || authDomain;
      projectId = stripQuotes(json.data.projectId) || projectId;
      appId = stripQuotes(json.data.appId) || appId;
      oAuthClientId = stripQuotes(json.data.oAuthClientId) || oAuthClientId;
    }
  } catch {
    // Ignore network fallback failure
  }

  return {
    apiKey,
    authDomain: authDomain || `${projectId}.firebaseapp.com`,
    projectId,
    appId,
    oAuthClientId,
  };
}

function loadGoogleIdentityServicesScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window is not available.'));
  }
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google Identity Services.')),
        { once: true },
      );
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Failed to load Google Identity Services.'));
    document.head.appendChild(script);
  });
}

async function requestGoogleTokenViaGsiBrandPopup(
  clientId: string,
): Promise<string> {
  await loadGoogleIdentityServicesScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('Google Identity Services OAuth2 client unavailable.');
  }

  return await new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: ['openid', ...SCOPES].join(' '),
      prompt: 'select_account',
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(
            new Error(
              response.error_description ||
                response.error ||
                'Google OAuth failed.',
            ),
          );
          return;
        }
        resolve(response.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err.message || err.type || 'Google popup closed.'));
      },
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
}

export async function signInWithFirebaseGooglePopup(): Promise<FirebaseGooglePopupPayload> {
  const cfg = await resolveFirebaseWebConfig();
  if (
    !cfg.apiKey ||
    cfg.apiKey === 'your_firebase_web_api_key' ||
    cfg.apiKey === 'demo-firebase-api-key' ||
    !cfg.projectId
  ) {
    throw new Error('Firebase Web API Key is not configured in .env.');
  }

  if (!cachedApp) {
    cachedApp =
      getApps().length > 0
        ? getApp()
        : initializeApp({
            apiKey: cfg.apiKey,
            authDomain: cfg.authDomain,
            projectId: cfg.projectId,
            appId: cfg.appId,
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

  const isLocalhostOrigin =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1');
  const localhostGsiEnabled =
    stripQuotes(String(import.meta.env.VITE_GOOGLE_OAUTH_LOCALHOST_READY ?? '')) ===
    'true';

  // Prefer Google Identity Services popup when oAuthClientId is present on
  // authorized origins (or on localhost once added to Authorized JS Origins in GCP)
  if (cfg.oAuthClientId && (!isLocalhostOrigin || localhostGsiEnabled)) {
    try {
      const accessToken = await requestGoogleTokenViaGsiBrandPopup(
        cfg.oAuthClientId,
      );
      cachedGoogleAccessToken = accessToken;
      const credential = GoogleAuthProvider.credential(null, accessToken);
      const userCredential = await signInWithCredential(cachedAuth, credential);
      const idToken = await userCredential.user.getIdToken();
      return {
        uid: userCredential.user.uid,
        email: userCredential.user.email ?? 'kartikrawat9@gmail.com',
        displayName: userCredential.user.displayName ?? 'Kartik Rawat',
        avatarUrl: userCredential.user.photoURL ?? null,
        idToken,
      };
    } catch {
      // Fall through to standard Firebase signInWithPopup if GIS is blocked
    }
  }

  const provider = new GoogleAuthProvider();
  for (const scope of SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({ prompt: 'select_account' });

  const result = await signInWithPopup(cachedAuth, provider);
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
  window.__kartikFirebaseGooglePopup = signInWithFirebaseGooglePopup;
}
