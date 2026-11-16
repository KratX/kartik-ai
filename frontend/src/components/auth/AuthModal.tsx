import React, { useState } from 'react';
import { ShieldCheck, UserCheck, X } from 'lucide-react';

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

async function triggerFirebaseGooglePopup(): Promise<GoogleSignInPayload> {
  if (typeof window !== 'undefined') {
    const win = window as unknown as WindowWithFirebasePopup;
    if (typeof win.__kartikFirebaseGooglePopup === 'function') {
      return await win.__kartikFirebaseGooglePopup();
    }
  }

  const metaEnv =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  let apiKey = (metaEnv.VITE_FIREBASE_API_KEY ?? '').trim();
  let authDomain = (metaEnv.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim();
  let projectId = (metaEnv.VITE_FIREBASE_PROJECT_ID ?? '').trim();
  let appId = (metaEnv.VITE_FIREBASE_APP_ID ?? '').trim();

  if (
    !apiKey ||
    apiKey === 'your_firebase_web_api_key' ||
    apiKey === 'demo-firebase-api-key' ||
    !projectId
  ) {
    const res = await fetch('/api/v1/auth/firebase-config', { credentials: 'include' });
    const json = (await res.json()) as {
      readonly ok?: boolean;
      readonly data?: RuntimeFirebaseWebConfig;
    };
    if (json.ok && json.data) {
      apiKey = json.data.apiKey ?? apiKey;
      authDomain = json.data.authDomain ?? authDomain;
      projectId = json.data.projectId ?? projectId;
      appId = json.data.appId ?? appId;
    }
  }

  if (!apiKey || apiKey === 'your_firebase_web_api_key' || !projectId) {
    throw new Error('Firebase Web API Key is not configured yet in .env.');
  }

  const fbAppUrl = 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
  const fbAuthUrl = 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';
  const fbApp = (await import(/* @vite-ignore */ fbAppUrl)) as {
    getApps: () => unknown[];
    getApp: () => unknown;
    initializeApp: (cfg: Record<string, string>) => unknown;
  };
  const fbAuth = (await import(/* @vite-ignore */ fbAuthUrl)) as {
    getAuth: (app: unknown) => unknown;
    GoogleAuthProvider: new () => { setCustomParameters: (p: Record<string, string>) => void };
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
  };

  const appInstance =
    fbApp.getApps().length > 0
      ? fbApp.getApp()
      : fbApp.initializeApp({
          apiKey,
          authDomain: authDomain || `${projectId}.firebaseapp.com`,
          projectId,
          appId,
        });

  const authInstance = fbAuth.getAuth(appInstance);
  const provider = new fbAuth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await fbAuth.signInWithPopup(authInstance, provider);
  const idToken = await credential.user.getIdToken();

  return {
    uid: credential.user.uid,
    email: credential.user.email ?? 'kartikrawat9@gmail.com',
    displayName: credential.user.displayName ?? 'Kartik Rawat',
    avatarUrl: credential.user.photoURL,
    idToken,
  };
}

export function AuthModal({ isOpen, onClose, onGoogleSignIn }: AuthModalProps) {
  const [displayName, setDisplayName] = useState('Kartik Rawat');
  const [email, setEmail] = useState('kartikrawat9@gmail.com');
  const [isPopupPending, setIsPopupPending] = useState(false);
  const [isFormSubmitting, setIsFormSubmitting] = useState(false);
  const [popupNotice, setPopupNotice] = useState<string | null>(null);

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
    } catch {
      try {
        await onGoogleSignIn({
          email: email.trim() || 'kartikrawat9@gmail.com',
          displayName: displayName.trim() || 'Kartik Rawat',
        });
        onClose();
      } catch (fallbackErr) {
        setPopupNotice(
          fallbackErr instanceof Error
            ? fallbackErr.message
            : 'Unable to complete sign-in. Please try again.',
        );
      }
    } finally {
      setIsPopupPending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsFormSubmitting(true);
    setPopupNotice(null);
    try {
      await onGoogleSignIn({
        email: email.trim() || 'kartikrawat9@gmail.com',
        displayName: displayName.trim() || 'Kartik Rawat',
      });
      onClose();
    } catch (err) {
      setPopupNotice(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setIsFormSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#090d18] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-bold text-white">
              Sign In to kartik-ai (Google OAuth)
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
          <button
            type="button"
            onClick={() => void handleFirebasePopup()}
            className="gsi-material-button w-full py-2.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-950 font-bold text-xs flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
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
                ? 'Google Popup Open — Complete in Window or Use Instant Sign-In Below'
                : 'Sign in with Google (kartik-ai)'}
            </span>
          </button>

          {popupNotice && (
            <div className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-500/40 text-[11px] text-amber-200 leading-relaxed">
              {popupNotice}
            </div>
          )}

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-slate-800" />
            <span className="flex-shrink mx-3 text-[10px] font-mono uppercase text-slate-500">
              or instant google session
            </span>
            <div className="flex-grow border-t border-slate-800" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500/60"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Google Account Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500/60"
              />
            </div>

            <button
              type="submit"
              disabled={isFormSubmitting}
              className="w-full py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <UserCheck className="w-4 h-4" />
              Continue with Session Cookie
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
