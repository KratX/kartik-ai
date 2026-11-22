import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, ShieldCheck, X } from 'lucide-react';
import { AnimatedBrandLogo, BorderBeam } from '../motion/primitives.js';

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

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          role="dialog"
          aria-modal="true"
          aria-label="Sign in to Kartik.ai"
          data-auth-modal="true"
          className="fixed inset-0 z-50 bg-black/82 backdrop-blur-md flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ type: 'spring', stiffness: 450, damping: 34 }}
            className="relative max-w-md w-full bg-[#111114] border border-white/[0.12] rounded-2xl overflow-hidden shadow-[0_28px_70px_-14px_rgba(0,0,0,0.92)]"
            onClick={(e) => e.stopPropagation()}
          >
            <BorderBeam durationSec={8} intensity={isPopupPending ? 'thinking' : 'idle'} />

            {/* Obsidian Micro-Dot Hero Header */}
            <div className="relative z-10 px-5 py-5 border-b border-white/[0.08] bg-[#0c0c0f] overflow-hidden">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 kartik-hero-dot-grid opacity-35"
              />
              <div className="relative z-10 flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <AnimatedBrandLogo
                    size="md"
                    subtitle="Sync workspace & credits"
                    dataTestAttr="auth-modal"
                  />
                  <h3 className="text-base font-semibold tracking-tight text-white">
                    Sign in to your workspace
                  </h3>
                </div>
                <button
                  type="button"
                  aria-label="Close sign in modal"
                  onClick={onClose}
                  className="p-1.5 rounded-lg bg-[#18181c] hover:bg-white/[0.12] text-zinc-400 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="relative z-10 p-5 space-y-4">
              <p className="text-xs text-zinc-400 leading-relaxed">
                Kartik.ai works immediately without an account. Link Google anytime to keep your history and billing unified across devices.
              </p>

              {/* Clean Unboxed Benefit List */}
              <ul className="space-y-2 py-1 text-xs text-zinc-300">
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Persistent cloud threads &amp; split-screen artifacts</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Verified Razorpay credit wallet &amp; immutable ledger</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Firebase ID token verification &amp; strict tenant isolation</span>
                </li>
              </ul>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  disabled={isPopupPending}
                  onClick={() => void handleFirebasePopup()}
                  className="gsi-material-button w-full py-2.5 px-4 rounded-xl bg-white hover:bg-zinc-200 disabled:opacity-60 text-zinc-950 font-semibold text-xs flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
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
                      : 'Sign in with Google'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2 px-4 rounded-xl bg-[#18181c] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-300 hover:text-white font-medium text-xs transition-colors cursor-pointer"
                >
                  Continue Without Signing In
                </button>
              </div>

              {popupNotice && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 leading-relaxed">
                  {popupNotice}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
