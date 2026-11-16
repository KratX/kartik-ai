import React, { useState } from 'react';
import { ShieldCheck, Sparkles, UserCheck, X } from 'lucide-react';

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
  readonly apiKey?: string;
  readonly authDomain?: string;
  readonly projectId?: string;
  readonly appId?: string;
  readonly enabled?: boolean;
}

async function triggerFirebaseGooglePopup(): Promise<GoogleSignInPayload> {
  const metaEnv =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  let apiKey = (metaEnv.VITE_FIREBASE_API_KEY ?? '').trim();
  let authDomain = (metaEnv.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim();
  let projectId = (metaEnv.VITE_FIREBASE_PROJECT_ID ?? '').trim();
  let appId = (metaEnv.VITE_FIREBASE_APP_ID ?? '').trim();

  if (!apiKey || apiKey === 'your_firebase_web_api_key' || !projectId) {
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

  const fbAppModuleName = 'firebase/app';
  const fbAuthModuleName = 'firebase/auth';
  const fbApp = (await import(/* @vite-ignore */ fbAppModuleName)) as {
    getApps: () => unknown[];
    getApp: () => unknown;
    initializeApp: (cfg: Record<string, string>) => unknown;
  };
  const fbAuth = (await import(/* @vite-ignore */ fbAuthModuleName)) as {
    getAuth: (app: unknown) => unknown;
    GoogleAuthProvider: new () => unknown;
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [popupNotice, setPopupNotice] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const handleFirebasePopup = async () => {
    setIsSubmitting(true);
    setPopupNotice(null);
    try {
      const payload = await triggerFirebaseGooglePopup();
      await onGoogleSignIn(payload);
      onClose();
    } catch (err) {
      setPopupNotice(
        err instanceof Error
          ? `${err.message} — You can also sign in directly below.`
          : 'Google popup closed or blocked — use the instant session sign-in below.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setPopupNotice(null);
    try {
      await onGoogleSignIn({
        email: email.trim() || 'kartikrawat9@gmail.com',
        displayName: displayName.trim() || 'Kartik Rawat',
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#090d18] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-bold text-white">
              Sign In to Kartik.ai (Firebase Google OAuth)
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
            disabled={isSubmitting}
            onClick={() => void handleFirebasePopup()}
            className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-sky-600" />
            Sign In with Google Popup (Firebase Auth)
          </button>

          {popupNotice && (
            <div className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-500/40 text-[11px] text-amber-200 leading-relaxed">
              {popupNotice}
            </div>
          )}

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-slate-800" />
            <span className="flex-shrink mx-3 text-[10px] font-mono uppercase text-slate-500">
              or instant dev session
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
              disabled={isSubmitting}
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
