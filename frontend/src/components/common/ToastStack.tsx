import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from 'lucide-react';

export type WorkspaceToastTone = 'success' | 'info' | 'warning' | 'error';

export interface WorkspaceToast {
  readonly id: string;
  readonly message: string;
  readonly tone: WorkspaceToastTone;
}

export interface ToastStackProps {
  readonly toasts: readonly WorkspaceToast[];
  readonly onDismiss: (id: string) => void;
}

function getToneIcon(tone: WorkspaceToastTone) {
  switch (tone) {
    case 'success':
      return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
    case 'error':
      return <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />;
    default:
      return <Info className="w-4 h-4 text-zinc-300 shrink-0" />;
  }
}

function getToneBorder(tone: WorkspaceToastTone): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-500/30';
    case 'warning':
      return 'border-amber-500/35';
    case 'error':
      return 'border-rose-500/40';
    default:
      return 'border-white/[0.12]';
  }
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  return (
    <div
      aria-live="polite"
      aria-label="Workspace notifications"
      data-toast-stack="true"
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[min(22rem,calc(100vw-2rem))] pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            data-toast-item={toast.tone}
            className={`pointer-events-auto rounded-xl bg-[#111114]/96 backdrop-blur-xl border ${getToneBorder(toast.tone)} px-3.5 py-2.5 shadow-[0_18px_45px_-12px_rgba(0,0,0,0.92)] flex items-start gap-2.5`}
          >
            <div className="mt-0.5">{getToneIcon(toast.tone)}</div>
            <div className="flex-1 min-w-0 text-xs text-zinc-100 leading-relaxed break-words">
              {toast.message}
            </div>
            <button
              type="button"
              aria-label="Dismiss toast"
              onClick={() => onDismiss(toast.id)}
              className="p-0.5 rounded-md text-zinc-500 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
