import React from 'react';
import { motion } from 'motion/react';
import type { SpecialistAgentName } from '../../types/index.js';
import { TextShimmer } from '../motion/primitives.js';

const AGENT_STATUS_LABELS: Record<SpecialistAgentName, string> = {
  chat: 'Reasoning and synthesizing response…',
  search: 'Searching live web sources and verifying citations…',
  coding: 'Classifying intent and compiling sandboxed web bundle…',
  pdf: 'Compiling editorial multi-page %PDF-1.4 document…',
  ppt: 'Designing 16:9 keynote slide deck and speaker notes…',
  rag: 'Retrieving grounded document passages and page citations…',
  vision: 'Inspecting image layout, OCR text, and structure…',
  image: 'Art-directing prompt and rendering studio artwork…',
};

const AGENT_SHORT_TITLES: Record<SpecialistAgentName, string> = {
  chat: 'Chat',
  search: 'Web Search',
  coding: 'Coding',
  pdf: 'PDF Generator',
  ppt: 'PPT Studio',
  rag: 'PDF RAG',
  vision: 'Vision OCR',
  image: 'Image Studio',
};

export interface LoadingAnimationProps {
  readonly activeAgent?: SpecialistAgentName;
}

export function LoadingAnimation({ activeAgent = 'chat' }: LoadingAnimationProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      data-thinking-shimmer="true"
      className="flex items-start gap-3 py-3"
    >
      <div className="w-6 h-6 rounded-full border border-white/15 bg-white/[0.04] flex items-center justify-center shrink-0 mt-0.5">
        <span className="w-3 h-3 rounded-full border-[1.5px] border-zinc-600 border-t-white animate-spin" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="font-medium text-zinc-200">Kartik.ai</span>
          <span aria-hidden="true" className="text-zinc-600">
            ·
          </span>
          <span className="text-zinc-400">
            {AGENT_SHORT_TITLES[activeAgent] ?? 'Chat'}
          </span>
        </div>
        <div className="text-sm">
          <TextShimmer>
            {AGENT_STATUS_LABELS[activeAgent] ?? AGENT_STATUS_LABELS.chat}
          </TextShimmer>
        </div>
      </div>
    </motion.div>
  );
}
