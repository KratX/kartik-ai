import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { SpecialistAgentName } from '../../../backend/shared/contracts/index.js';

const AGENT_STATUS_LABELS: Record<SpecialistAgentName, string> = {
  chat: 'Chat Specialist is synthesizing a technical response...',
  search: 'Web Search Agent is querying live sources & assembling visual references...',
  coding: 'Coding Specialist is classifying intent & compiling sandboxed bundle...',
  pdf: 'PDF Generator Agent is compiling multi-page %PDF-1.4 binary document...',
  ppt: 'PPT Generator Agent is building 6-slide OpenXML .pptx presentation deck...',
  rag: 'PDF RAG Agent is retrieving grounded passages & page citations...',
  vision: 'Vision Specialist is running OCR & structural diagram analysis...',
  image: 'Image Generator Agent is enhancing prompt & rendering artwork...',
};

export interface LoadingAnimationProps {
  readonly activeAgent?: SpecialistAgentName;
}

export function LoadingAnimation({ activeAgent = 'chat' }: LoadingAnimationProps) {
  return (
    <div className="flex items-start gap-3.5 py-4 px-5 bg-slate-900/60 border border-slate-800/80 rounded-xl max-w-2xl">
      <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0 mt-0.5">
        <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs font-semibold text-sky-400 uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          <span>{activeAgent.toUpperCase()} AGENT ACTIVE</span>
        </div>
        <p className="text-sm text-slate-300 mt-1">
          {AGENT_STATUS_LABELS[activeAgent] ?? AGENT_STATUS_LABELS.chat}
        </p>
        <div className="mt-2.5 flex items-center gap-1.5">
          <span className="h-1.5 w-12 rounded-full bg-sky-500/50 animate-pulse" />
          <span className="h-1.5 w-20 rounded-full bg-indigo-500/40 animate-pulse" />
          <span className="h-1.5 w-8 rounded-full bg-emerald-500/40 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
