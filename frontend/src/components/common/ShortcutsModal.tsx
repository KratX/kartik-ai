import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Keyboard, X } from 'lucide-react';
import { BorderBeam } from '../motion/primitives.js';

export interface ShortcutsModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

const SHORTCUT_GROUPS: ReadonlyArray<{
  readonly title: string;
  readonly items: ReadonlyArray<{
    readonly keys: readonly string[];
    readonly description: string;
  }>;
}> = [
  {
    title: 'Navigation & Workspace',
    items: [
      { keys: ['⌘', 'K'], description: 'Open global Command Palette' },
      { keys: ['⌘', 'B'], description: 'Collapse or expand Sidebar rail' },
      { keys: ['?'], description: 'Toggle Keyboard Shortcuts sheet' },
      { keys: ['Esc'], description: 'Close open drawers, modals, or lightbox' },
    ],
  },
  {
    title: 'Composer & Specialists',
    items: [
      { keys: ['/'], description: 'Open Slash Command specialist menu' },
      { keys: ['Enter'], description: 'Send prompt to active specialist' },
      { keys: ['Shift', 'Enter'], description: 'Insert newline in composer' },
      { keys: ['←', '→'], description: 'Step slides in Slide Deck Studio' },
    ],
  },
];

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
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
          aria-label="Keyboard Shortcuts"
          data-shortcuts-modal="true"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ type: 'spring', stiffness: 450, damping: 34 }}
            className="relative w-full max-w-xl rounded-2xl bg-[#111114] border border-white/[0.12] shadow-[0_28px_70px_-14px_rgba(0,0,0,0.92)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <BorderBeam durationSec={8} intensity="idle" />

            <div className="relative z-10 px-5 py-4 border-b border-white/[0.08] bg-[#0c0c0f] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/[0.07] border border-white/[0.1] flex items-center justify-center text-white">
                  <Keyboard className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Keyboard Shortcuts
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Fast navigation across Unified Chat, Canvas &amp; Studios
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close keyboard shortcuts"
                onClick={onClose}
                className="p-1.5 rounded-lg bg-[#18181c] hover:bg-white/[0.12] text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative z-10 p-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.title} className="space-y-2.5">
                  <div className="text-[11px] font-medium text-zinc-500">
                    {group.title}
                  </div>
                  <div className="space-y-2">
                    {group.items.map((item) => (
                      <div
                        key={item.description}
                        className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.06] last:border-b-0"
                      >
                        <span className="text-xs text-zinc-200 leading-snug">
                          {item.description}
                        </span>
                        <span className="inline-flex items-center gap-1 shrink-0">
                          {item.keys.map((key) => (
                            <kbd
                              key={key}
                              className="min-w-[22px] px-1.5 py-0.5 text-center rounded-md bg-[#18181c] border border-white/[0.12] text-[10px] font-mono text-zinc-200"
                            >
                              {key}
                            </kbd>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
