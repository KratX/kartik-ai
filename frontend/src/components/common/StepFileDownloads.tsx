import React, { useState } from 'react';
import { Check, Copy, Download, FileCode, FolderArchive, GitCommit } from 'lucide-react';

export interface FixExportPackage {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly zipFilename: string;
  readonly zipHref: string;
  readonly commitMessage: string;
  readonly changedFiles: ReadonlyArray<{
    readonly path: string;
    readonly status: 'modified' | 'added';
    readonly downloadHref: string;
  }>;
}

export const FIX_EXPORT_PACKAGES: readonly FixExportPackage[] = [
  {
    id: 'fix-3',
    title: 'Fix #3 — Harden PostgreSQL TLS Certificate Verification (sslmode=verify-full / verify-ca / require)',
    subtitle:
      '4 files · Enforces rejectUnauthorized: true & SNI servername for verify-full, verify-ca, require & *.neon.tech unless sslmode=no-verify is explicitly configured',
    zipFilename: 'fix-3-postgres-tls-verification.zip',
    zipHref: '/__downloads/fix-3-postgres-tls-verification.zip',
    commitMessage: `security(db): harden PostgreSQL TLS certificate verification in @kartik/shared and root db pool

- Add resolvePostgresTlsConfig and POSTGRES_SSL_MODES in backend/shared/database/index.ts
- Enforce rejectUnauthorized: true (and SNI servername for verify-full) when sslmode=verify-full, verify-ca, require, or *.neon.tech is used instead of unconditionally setting rejectUnauthorized: false
- Support explicit opt-out via sslmode=no-verify, sslaccept=accept_invalid_certs, or PGSSL_REJECT_UNAUTHORIZED=false for self-signed dev/staging certificates
- Apply hardened resolvePostgresTlsConfig in src/db/index.ts and validate sslmode values in validatePostgresConnectionUrl
- Add unit tests in backend/shared/tests/database-storage.test.ts covering verify-full, verify-ca, require, no-verify, custom CA certs, and createLazyPostgresPool`,
    changedFiles: [
      {
        path: 'backend/shared/database/index.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=backend/shared/database/index.ts',
      },
      {
        path: 'src/db/index.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/db/index.ts',
      },
      {
        path: 'backend/shared/tests/database-storage.test.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=backend/shared/tests/database-storage.test.ts',
      },
      {
        path: 'frontend/src/components/common/StepFileDownloads.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=frontend/src/components/common/StepFileDownloads.tsx',
      },
    ],
  },
  {
    id: 'fix-2',
    title: 'Fix #2 — Full PostgreSQL Read/Write State Hydration in KartikPlatformRuntime',
    subtitle:
      '6 files · Hydrates users, conversations, messages, idempotent turn replays, credit balance, ledger & payment orders from PostgreSQL on cache miss + server-restart test',
    zipFilename: 'fix-2-postgres-read-write-hydration.zip',
    zipHref: '/__downloads/fix-2-postgres-read-write-hydration.zip',
    commitMessage: `feat(db,runtime): add full PostgreSQL read/write state hydration in KartikPlatformRuntime

- Add loadPlatformUserSnapshotFromCloudSql, PlatformPersistenceAdapter, cloudSqlPlatformPersistenceAdapter, and InMemoryPlatformPersistenceAdapter in src/db/platform-repository.ts
- Preserve existing user profile, planId, and availableCredits on conflict in src/db/users.ts instead of overwriting verified emails with synthetic fallback placeholders
- Implement hydrateUserFromPersistence, applyPersistedSnapshot, and flushPendingPersistence in KartikPlatformRuntime (src/server/platform-api-runtime.ts)
- Reconstruct idempotent turn replay cache and warm artifact/file metadata caches from persisted snapshots across server restarts
- Await runtime.hydrateUserFromPersistence(actor) across auth, conversation, message, and billing routes in server.ts
- Add multi-instance server-restart hydration integration test in src/server/platform-multi-user-isolation.test.ts`,
    changedFiles: [
      {
        path: 'src/db/platform-repository.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/db/platform-repository.ts',
      },
      {
        path: 'src/db/users.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/db/users.ts',
      },
      {
        path: 'src/server/platform-api-runtime.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/server/platform-api-runtime.ts',
      },
      {
        path: 'server.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=server.ts',
      },
      {
        path: 'src/server/platform-multi-user-isolation.test.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/server/platform-multi-user-isolation.test.ts',
      },
      {
        path: 'frontend/src/components/common/StepFileDownloads.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=frontend/src/components/common/StepFileDownloads.tsx',
      },
    ],
  },
  {
    id: 'fix-1',
    title: 'Fix #1 — Deduplicate Frontend Component Trees (src/components/* -> @kartik/frontend)',
    subtitle:
      '14 files · Consolidates duplicate root src/components/* & StepFileDownloads onto frontend/src/components/* single source of truth + regression test',
    zipFilename: 'fix-1-deduplicate-frontend-components.zip',
    zipHref: '/__downloads/fix-1-deduplicate-frontend-components.zip',
    commitMessage: `refactor(frontend): deduplicate root src/components tree into @kartik/frontend re-export barrels

- Convert 10 duplicate root component files under src/components/** and src/dev-exports/StepFileDownloads.tsx into thin re-export barrels pointing to frontend/src/components/**
- Remove ~1,800 lines of duplicated JSX, stale Nav props, and direct backend type imports from root UI files
- Add unit test in frontend/tests/multi-agent-workspace-ui.test.ts enforcing single-source-of-truth component barrels
- Mount /__downloads static route in server.ts and add Fix & ZIP Downloads drawer in Nav and App`,
    changedFiles: [
      {
        path: 'src/components/artifacts/ArtifactPanel.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/components/artifacts/ArtifactPanel.tsx',
      },
      {
        path: 'src/components/chat/ChatArea.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/components/chat/ChatArea.tsx',
      },
      {
        path: 'src/components/chat/ChatInput.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/components/chat/ChatInput.tsx',
      },
      {
        path: 'src/components/chat/MarkdownRenderer.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/components/chat/MarkdownRenderer.tsx',
      },
      {
        path: 'src/components/chat/MessageBubble.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/components/chat/MessageBubble.tsx',
      },
      {
        path: 'src/components/chat/MessageList.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/components/chat/MessageList.tsx',
      },
      {
        path: 'src/components/chat/SlideDeckPreview.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/components/chat/SlideDeckPreview.tsx',
      },
      {
        path: 'src/components/common/LoadingAnimation.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/components/common/LoadingAnimation.tsx',
      },
      {
        path: 'src/components/layout/Nav.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/components/layout/Nav.tsx',
      },
      {
        path: 'src/components/layout/Sidebar.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/components/layout/Sidebar.tsx',
      },
      {
        path: 'src/dev-exports/StepFileDownloads.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/dev-exports/StepFileDownloads.tsx',
      },
      {
        path: 'frontend/src/components/common/StepFileDownloads.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=frontend/src/components/common/StepFileDownloads.tsx',
      },
      {
        path: 'frontend/src/components/layout/Nav.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=frontend/src/components/layout/Nav.tsx',
      },
      {
        path: 'frontend/src/App.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=frontend/src/App.tsx',
      },
      {
        path: 'frontend/tests/multi-agent-workspace-ui.test.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=frontend/tests/multi-agent-workspace-ui.test.ts',
      },
      {
        path: 'server.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=server.ts',
      },
    ],
  },
];

export function StepFileDownloads() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyCommit = (id: string, message: string) => {
    void navigator.clipboard?.writeText(message);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="flex flex-col gap-4">
      {FIX_EXPORT_PACKAGES.map((pkg) => (
        <div
          key={pkg.id}
          className="bg-slate-900/95 border border-emerald-500/40 text-slate-100 rounded-xl p-5 space-y-4 shadow-lg"
        >
          {/* Header + Full ZIP Download */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-400">
                <FolderArchive className="w-3.5 h-3.5" />
                <span>Ready for Repo Drop-In Overwrite</span>
              </div>
              <div className="text-sm sm:text-base font-bold text-white">
                {pkg.title}
              </div>
              <div className="text-xs text-slate-400 font-mono">
                {pkg.subtitle}
              </div>
            </div>

            <a
              href={pkg.zipHref}
              download={pkg.zipFilename}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow"
            >
              <Download className="w-4 h-4" />
              Download {pkg.zipFilename}
            </a>
          </div>

          {/* Git Commit Message Box */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/90 overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900 border-b border-slate-800 text-xs">
              <div className="flex items-center gap-2 font-mono text-sky-300 font-semibold">
                <GitCommit className="w-3.5 h-3.5 text-sky-400" />
                <span>Git Commit Message</span>
              </div>
              <button
                type="button"
                onClick={() => handleCopyCommit(pkg.id, pkg.commitMessage)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono cursor-pointer"
              >
                {copiedId === pkg.id ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy Commit Message</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3.5 text-xs font-mono text-slate-200 whitespace-pre-wrap leading-relaxed">
              {pkg.commitMessage}
            </pre>
          </div>

          {/* Individual Changed Files List */}
          <div className="space-y-2">
            <div className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">
              Updated &amp; Changed Files ({pkg.changedFiles.length}) — Click any file to download individually
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {pkg.changedFiles.map((file) => (
                <a
                  key={file.path}
                  href={file.downloadHref}
                  download={file.path.split('/').pop()}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950/80 hover:bg-slate-800/90 border border-slate-800/90 hover:border-sky-500/40 text-xs transition-colors group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span className="font-mono text-slate-200 truncate group-hover:text-sky-300">
                      {file.path}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      {file.status}
                    </span>
                    <Download className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-400" />
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
