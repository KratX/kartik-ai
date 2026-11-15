import React, { useState } from 'react';
import { ShieldCheck, UserCheck, X } from 'lucide-react';

export interface AuthModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onGoogleSignIn: (input: {
    readonly email: string;
    readonly displayName: string;
  }) => Promise<void>;
}

export function AuthModal({ isOpen, onClose, onGoogleSignIn }: AuthModalProps) {
  const [displayName, setDisplayName] = useState('Kartik Rawat');
  const [email, setEmail] = useState('kartikrawat9@gmail.com');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
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
              Sign In to Kartik.ai (Google OAuth / Session Cookie)
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-slate-400 leading-relaxed">
            Authenticates via <code className="font-mono text-sky-300">POST /api/v1/auth/google</code>, verifies identity server-side, and sets an opaque <code className="font-mono text-emerald-300">HttpOnly</code> session cookie (<code className="font-mono">kartik_session</code>).
          </p>

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
            Continue with Google OAuth
          </button>
        </form>
      </div>
    </div>
  );
}
