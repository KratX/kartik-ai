import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  type Auth,
} from 'firebase/auth';

export interface FirebaseGooglePopupPayload {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly idToken: string;
}

interface RuntimeFirebaseWebConfig {
  readonly apiKey?: string;
  readonly authDomain?: string;
  readonly projectId?: string;
  readonly appId?: string;
  readonly enabled?: boolean;
}

declare global {
  interface Window {
    __kartikFirebaseGooglePopup?: () => Promise<FirebaseGooglePopupPayload>;
  }
}

function stripQuotes(value?: string): string {
  return (value ?? '').trim().replace(/^["']|["']$/g, '');
}

async function resolveFirebaseWebConfig(): Promise<{
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}> {
  let apiKey = stripQuotes(String(import.meta.env.VITE_FIREBASE_API_KEY ?? ''));
  let authDomain = stripQuotes(String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? ''));
  let projectId = stripQuotes(String(import.meta.env.VITE_FIREBASE_PROJECT_ID ?? ''));
  let appId = stripQuotes(String(import.meta.env.VITE_FIREBASE_APP_ID ?? ''));

  const isPlaceholder =
    !apiKey ||
    apiKey === 'your_firebase_web_api_key' ||
    apiKey === 'demo-firebase-api-key' ||
    !projectId ||
    projectId === 'demo-project';

  if (isPlaceholder) {
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
      }
    } catch {
      // Ignore network fallback failure
    }
  }

  return {
    apiKey,
    authDomain: authDomain || `${projectId}.firebaseapp.com`,
    projectId,
    appId,
  };
}

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;

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

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  const credential = await signInWithPopup(cachedAuth, provider);
  const idToken = await credential.user.getIdToken();

  return {
    uid: credential.user.uid,
    email: credential.user.email ?? 'kartikrawat9@gmail.com',
    displayName: credential.user.displayName ?? 'Kartik Rawat',
    avatarUrl: credential.user.photoURL ?? null,
    idToken,
  };
}

if (typeof window !== 'undefined') {
  window.__kartikFirebaseGooglePopup = signInWithFirebaseGooglePopup;
}
