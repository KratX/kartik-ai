import React, { useEffect, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';

export interface GoogleSignInPayload {
  readonly uid?: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl?: string | null;
  readonly idToken?: string;
}

export interface AuthModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onGoogleSignIn: (input: GoogleSignInPayload) => Promise<void>;
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

interface WindowWithFirebasePopup {
  readonly __kartikFirebaseGooglePopup?: () => Promise<GoogleSignInPayload>;
}

interface CdnFirebaseAppModule {
  getApps: () => unknown[];
  getApp: () => unknown;
  initializeApp: (cfg: Record<string, string>) => unknown;
}

interface CdnFirebaseAuthModule {
  getAuth: (app: unknown) => unknown;
  GoogleAuthProvider: new () => {
    addScope?: (scope: string) => void;
    setCustomParameters: (p: Record<string, string>) => void;
  };
  signInWithPopup: (
    auth: unknown,
    provider: unknown,
  ) => Promise<{
    user: {
      uid: string;
      email: string | null;
      displayName: string | null;
      photoURL: string | null;
      getIdToken: () => Promise<string>;
    };
  }>;
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

let cachedWebConfig: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
} = (() => {
  const metaEnv =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const apiKey = stripQuotes(metaEnv.VITE_FIREBASE_API_KEY);
  const projectId = stripQuotes(metaEnv.VITE_FIREBASE_PROJECT_ID);
  const authDomain = stripQuotes(metaEnv.VITE_FIREBASE_AUTH_DOMAIN);
  const appId = stripQuotes(metaEnv.VITE_FIREBASE_APP_ID);
  return {
    apiKey: PLACEHOLDER_API_KEYS.has(apiKey.toLowerCase()) ? '' : apiKey,
    projectId: PLACEHOLDER_PROJECT_IDS.has(projectId.toLowerCase()) ? '' : projectId,
    authDomain:
      authDomain && !authDomain.includes('your-firebase-project') ? authDomain : '',
    appId,
  };
})();

let preloadedFbApp: CdnFirebaseAppModule | null = null;
let preloadedFbAuth: CdnFirebaseAuthModule | null = null;
let preloadedAuthInstance: unknown = null;

async function preloadFirebaseSdkAndConfig(): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }
  const win = window as unknown as WindowWithFirebasePopup;
  if (typeof win.__kartikFirebaseGooglePopup === 'function') {
    return;
  }

  try {
    if (!cachedWebConfig.apiKey || !cachedWebConfig.projectId) {
      const res = await fetch('/api/v1/auth/firebase-config', {
        credentials: 'include',
      });
      if (res.ok) {
        const json = (await res.json()) as {
          readonly ok?: boolean;
          readonly data?: RuntimeFirebaseWebConfig;
        };
        if (json.data) {
          const apiKey = stripQuotes(json.data.apiKey);
          const projectId = stripQuotes(json.data.projectId);
          const authDomain = stripQuotes(json.data.authDomain);
          const appId = stripQuotes(json.data.appId);
          if (
            apiKey &&
            !PLACEHOLDER_API_KEYS.has(apiKey.toLowerCase()) &&
            projectId &&
            !PLACEHOLDER_PROJECT_IDS.has(projectId.toLowerCase())
          ) {
            cachedWebConfig = {
              apiKey,
              projectId,
              authDomain: authDomain || `${projectId}.firebaseapp.com`,
              appId,
            };
          }
        }
      }
    }

    if (!preloadedFbApp || !preloadedFbAuth) {
      const fbAppUrl = 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
      const fbAuthUrl = 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';
      const [appMod, authMod] = await Promise.all([
        import(/* @vite-ignore */ fbAppUrl) as Promise<CdnFirebaseAppModule>,
        import(/* @vite-ignore */ fbAuthUrl) as Promise<CdnFirebaseAuthModule>,
      ]);
      preloadedFbApp = appMod;
      preloadedFbAuth = authMod;
    }

    if (
      preloadedFbApp &&
      preloadedFbAuth &&
      cachedWebConfig.apiKey &&
      cachedWebConfig.projectId &&
      !preloadedAuthInstance
    ) {
      const appInstance =
        preloadedFbApp.getApps().length > 0
          ? preloadedFbApp.getApp()
          : preloadedFbApp.initializeApp({
              apiKey: cachedWebConfig.apiKey,
              authDomain:
                cachedWebConfig.authDomain ||
                `${cachedWebConfig.projectId}.firebaseapp.com`,
              projectId: cachedWebConfig.projectId,
              appId: cachedWebConfig.appId,
            });
      preloadedAuthInstance = preloadedFbAuth.getAuth(appInstance);
    }
  } catch {
    // Non-fatal preload warning; will retry on click
  }
}

async function triggerFirebaseGooglePopup(): Promise<GoogleSignInPayload> {
  if (typeof window !== 'undefined') {
    const win = window as unknown as WindowWithFirebasePopup;
    if (typeof win.__kartikFirebaseGooglePopup === 'function') {
      return await win.__kartikFirebaseGooglePopup();
    }
  }

  if (!preloadedAuthInstance || !preloadedFbAuth) {
    await preloadFirebaseSdkAndConfig();
  }

  if (
    !cachedWebConfig.apiKey ||
    !cachedWebConfig.projectId ||
    !preloadedFbAuth ||
    !preloadedAuthInstance
  ) {
    throw new Error('Firebase Web API Key is not configured yet in .env.');
  }

  const provider = new preloadedFbAuth.GoogleAuthProvider();
  if (typeof provider.addScope === 'function') {
    provider.addScope('https://www.googleapis.com/auth/userinfo.email');
    provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
  }
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await preloadedFbAuth.signInWithPopup(
    preloadedAuthInstance,
    provider,
  );
  const idToken = await credential.user.getIdToken();
  const email = credential.user.email ?? '';
  const displayName =
    credential.user.displayName ?? (email.split('@')[0] || 'Google User');

  return {
    uid: credential.user.uid,
    email,
    displayName,
    avatarUrl: credential.user.photoURL,
    idToken,
  };
}

function describeFirebasePopupError(err: unknown): {
  readonly code: string;
  readonly message: string;
} {
  const errObj = err as { code?: string; message?: string } | undefined;
  const code = typeof errObj?.code === 'string' ? errObj.code : '';
  const rawMessage =
    err instanceof Error ? err.message : String(errObj?.message ?? 'Google sign-in failed');

  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    rawMessage.includes('popup-closed-by-user')
  ) {
    return {
      code,
      message:
        'Google sign-in popup was closed before completing. Click "Sign in from Google" to try again.',
    };
  }

  if (code === 'auth/unauthorized-domain' || rawMessage.includes('unauthorized-domain')) {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    return {
      code,
      message: `Domain "${host}" is not yet authorized in Firebase Console (gen-lang-client-0503610321 → Authentication → Settings → Authorized domains). Add "${host}" there to enable Google popup sign-in.`,
    };
  }

  if (code === 'auth/popup-blocked' || rawMessage.includes('popup-blocked')) {
    return {
      code,
      message:
        'Browser blocked the Google sign-in popup. Please allow popups for this site and try again.',
    };
  }

  return {
    code,
    message: rawMessage,
  };
}

export function AuthModal({ isOpen, onClose, onGoogleSignIn }: AuthModalProps) {
  const [isPopupPending, setIsPopupPending] = useState(false);
  const [popupNotice, setPopupNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      void preloadFirebaseSdkAndConfig();
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleFirebasePopup = async () => {
    setIsPopupPending(true);
    setPopupNotice(null);
    try {
      const payload = await triggerFirebaseGooglePopup();
      await onGoogleSignIn(payload);
      onClose();
    } catch (popupErr) {
      const diagnosed = describeFirebasePopupError(popupErr);
      setPopupNotice(diagnosed.message);
    } finally {
      setIsPopupPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#090d18] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-bold text-white">
              Sign in from Google
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-400 leading-relaxed">
            Authenticate with your Google account via Firebase OAuth to start an authenticated session.
          </p>

          <button
            type="button"
            disabled={isPopupPending}
            onClick={() => void handleFirebasePopup()}
            className="gsi-material-button w-full py-2.5 px-4 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-60 text-slate-950 font-bold text-xs flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
          >
            <svg
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 48 48"
              className="w-4 h-4 shrink-0"
            >
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
              <path fill="none" d="M0 0h48v48H0z" />
            </svg>
            <span className="gsi-material-button-contents">
              {isPopupPending
                ? 'Google Popup Open — Complete in Window…'
                : 'Sign in from Google'}
            </span>
          </button>

          {popupNotice && (
            <div className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-500/40 text-[11px] text-amber-200 leading-relaxed">
              {popupNotice}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
