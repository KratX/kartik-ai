import React from 'react';
import { Download } from 'lucide-react';

export function StepFileDownloads() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="bg-slate-900 border border-emerald-500/40 text-slate-100 rounded-lg px-5 py-3.5 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-100">
            Micro-step 9.6.a (Phase 16 &amp; 18 Final — 6 Multi-Stage pnpm Dockerfiles &amp; AWS Profile P / S Infrastructure) — Affected Files
          </div>
          <div className="text-xs text-slate-400 font-mono mt-0.5">
            step-9.6.a.zip (16 files · IST-aligned timestamps · 42 Suites / 147 Tests Passing · 100% Complete)
          </div>
        </div>

        <a
          href="/__downloads/step-9.6.a.zip"
          download="step-9.6.a.zip"
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          Download ZIP
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href="/__downloads/step-9.5.a.zip"
          download="step-9.5.a.zip"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 rounded-md transition-colors"
        >
          <Download className="w-3 h-3 text-emerald-400" />
          step-9.5.a.zip (11 files)
        </a>
        <a
          href="/__downloads/step-9.4.a.zip"
          download="step-9.4.a.zip"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 rounded-md transition-colors"
        >
          <Download className="w-3 h-3 text-emerald-400" />
          step-9.4.a.zip (14 files)
        </a>
        <a
          href="/__downloads/step-9.3.a.zip"
          download="step-9.3.a.zip"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 rounded-md transition-colors"
        >
          <Download className="w-3 h-3 text-emerald-400" />
          step-9.3.a.zip (10 files)
        </a>
        <a
          href="/__downloads/step-9.2.a.zip"
          download="step-9.2.a.zip"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 rounded-md transition-colors"
        >
          <Download className="w-3 h-3 text-emerald-400" />
          step-9.2.a.zip (13 files)
        </a>
        <a
          href="/__downloads/step-9.1.a.zip"
          download="step-9.1.a.zip"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 rounded-md transition-colors"
        >
          <Download className="w-3 h-3 text-emerald-400" />
          step-9.1.a.zip (16 files)
        </a>
      </div>
    </div>
  );
}
