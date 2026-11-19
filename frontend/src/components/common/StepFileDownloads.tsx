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
    id: 'fix-8',
    title: 'Fix #8 — Eliminate Specialist 500 INTERNAL_ERROR (DB Auto-Bootstrap + Fallback & Gemini 403/400 Model Retry)',
    subtitle:
      '6 files · Fixes 500 INTERNAL_ERROR across Coding/PDF/PPT/Image/RAG/Vision when PostgreSQL tables/columns are missing or unreachable, adds server 5xx logging, and retries Gemini fallback models on HTTP 400/403',
    zipFilename: 'fix-8-db-fallback-and-gemini-resilience.zip',
    zipHref: '/__downloads/fix-8-db-fallback-and-gemini-resilience.zip',
    commitMessage: `fix(db,agent): eliminate specialist 500 INTERNAL_ERROR via auto-schema bootstrap, graceful local DB fallback, and Gemini 400/403 model retries

- Add idempotent ensurePlatformSchemaReady() in src/db/platform-repository.ts (CREATE TABLE IF NOT EXISTS for all 8 tables + ALTER TABLE users ADD COLUMN IF NOT EXISTS reserved_credits) so fresh or pre-Fix-#4 PostgreSQL/Neon databases never crash artifact/file specialists
- Replace raw Error throws in DrizzleCloudSqlAgentRepository, DrizzleCloudSqlObjectStorage, and platform sync helpers with a 30s degraded circuit breaker and clean local cache/filesystem fallback while preserving 404 NOT_FOUND tenant isolation
- Log 5xx error details (method, URL, traceId, message, cause) in server.ts sendError when NODE_ENV !== test for instant diagnostics
- Expand createServerGeminiClient model-candidate fallback retries in backend/services/agent/src/services/live-gemini-providers.ts to include HTTP 400 and 403 so personal Gemini API keys seamlessly fall back from gemini-4-hydrogen to gemini-2.5-flash (and image fallbacks)
- Normalize empty css/js fields in LiveGeminiCodingModelProvider so manifest size validation never rejects valid HTML bundles
- Add Fix #8 regression tests in src/server/platform-multi-user-isolation.test.ts and backend/services/agent/tests/live-providers-and-limits.test.ts`,
    changedFiles: [
      {
        path: 'src/db/platform-repository.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/db/platform-repository.ts',
      },
      {
        path: 'server.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=server.ts',
      },
      {
        path: 'backend/services/agent/src/services/live-gemini-providers.ts',
        status: 'modified',
        downloadHref:
          '/__downloads/file?path=backend/services/agent/src/services/live-gemini-providers.ts',
      },
      {
        path: 'src/server/platform-multi-user-isolation.test.ts',
        status: 'modified',
        downloadHref:
          '/__downloads/file?path=src/server/platform-multi-user-isolation.test.ts',
      },
      {
        path: 'backend/services/agent/tests/live-providers-and-limits.test.ts',
        status: 'modified',
        downloadHref:
          '/__downloads/file?path=backend/services/agent/tests/live-providers-and-limits.test.ts',
      },
      {
        path: 'frontend/src/components/common/StepFileDownloads.tsx',
        status: 'modified',
        downloadHref:
          '/__downloads/file?path=frontend/src/components/common/StepFileDownloads.tsx',
      },
    ],
  },
  {
    id: 'fix-7',
    title: 'Fix #7 — Pure Gemini-Only AI Stack (Remove Groq, Tavily, OpenRouter & Cloudflare AI)',
    subtitle:
      '12 files · Consolidates all 8 agents strictly onto Google Gemini API (gemini-4-hydrogen, googleSearch grounding, gemini-embedding-2, gemini-3.1-flash-lite-image) with only GEMINI_API_KEY required',
    zipFilename: 'fix-7-gemini-only-ai-stack.zip',
    zipHref: '/__downloads/fix-7-gemini-only-ai-stack.zip',
    commitMessage: `refactor(agent): remove Groq, Tavily, OpenRouter, and Cloudflare AI so all agents run exclusively on Gemini

- Remove Groq, OpenRouter, Tavily, and Cloudflare Workers AI Flux adapters from backend/services/agent/src/services/live-gemini-providers.ts, routing Chat, Search (googleSearch grounding), Coding, PDF, PPT, RAG embeddings, Vision, and Image Generation strictly through Google Gemini API
- Remove TAVILY_API_KEY from backend/services/agent/src/config/index.ts and update default model IDs to gemini-4-hydrogen and gemini-embedding-2 so only GEMINI_API_KEY is required when MOCK_AI=false
- Simplify live AI key detection in src/server/platform-api-runtime.ts and scripts/start-local-stack.mjs to GEMINI_API_KEY only
- Clean up .env.example to remove GROQ_API_KEY, TAVILY_API_KEY, OPENROUTER_API_KEY, CLOUDFLARE_* AI vars, and Llama/Qwen model overrides
- Rename MockSearchProvider.providerName from mock-tavily-search to mock-gemini-search
- Update agent unit tests to verify all specialist providers call only generativelanguage.googleapis.com and ignore any legacy third-party AI keys`,
    changedFiles: [
      {
        path: 'backend/services/agent/src/services/live-gemini-providers.ts',
        status: 'modified',
        downloadHref:
          '/__downloads/file?path=backend/services/agent/src/services/live-gemini-providers.ts',
      },
      {
        path: 'backend/services/agent/src/config/index.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=backend/services/agent/src/config/index.ts',
      },
      {
        path: 'backend/services/agent/src/services/mock-providers.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=backend/services/agent/src/services/mock-providers.ts',
      },
      {
        path: 'src/server/platform-api-runtime.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/server/platform-api-runtime.ts',
      },
      {
        path: '.env.example',
        status: 'modified',
        downloadHref: '/__downloads/file?path=.env.example',
      },
      {
        path: 'scripts/start-local-stack.mjs',
        status: 'modified',
        downloadHref: '/__downloads/file?path=scripts/start-local-stack.mjs',
      },
      {
        path: 'backend/services/agent/tests/agent-foundation.test.ts',
        status: 'modified',
        downloadHref:
          '/__downloads/file?path=backend/services/agent/tests/agent-foundation.test.ts',
      },
      {
        path: 'backend/services/agent/tests/agent-graph.test.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=backend/services/agent/tests/agent-graph.test.ts',
      },
      {
        path: 'backend/services/agent/tests/artifact-content-and-upload-routes.test.ts',
        status: 'modified',
        downloadHref:
          '/__downloads/file?path=backend/services/agent/tests/artifact-content-and-upload-routes.test.ts',
      },
      {
        path: 'backend/services/agent/tests/pdf-ppt-generators.test.ts',
        status: 'modified',
        downloadHref:
          '/__downloads/file?path=backend/services/agent/tests/pdf-ppt-generators.test.ts',
      },
      {
        path: 'backend/services/agent/tests/live-providers-and-limits.test.ts',
        status: 'modified',
        downloadHref:
          '/__downloads/file?path=backend/services/agent/tests/live-providers-and-limits.test.ts',
      },
      {
        path: 'frontend/src/components/common/StepFileDownloads.tsx',
        status: 'modified',
        downloadHref:
          '/__downloads/file?path=frontend/src/components/common/StepFileDownloads.tsx',
      },
    ],
  },
  {
    id: 'fix-6',
    title: 'Fix #6 — Fix All 7 Specialist Agents (Search, Coding, PDF, PPT, RAG, Vision, Image) for Real Live AI',
    subtitle:
      '8 files · Raises 8s timeout to 45s, adds Groq & OpenRouter fallbacks for every specialist, enables real Gemini/Flux image generation + inline <img> previews, and synthesizes Search/RAG/Coding replies via LLM',
    zipFilename: 'fix-6-all-specialist-agents-live.zip',
    zipHref: '/__downloads/fix-6-all-specialist-agents-live.zip',
    commitMessage: `fix(agent): enable real multi-provider AI execution across all 7 specialist agents and inline image previews

- Update LiveGemini* providers in backend/services/agent/src/services/live-gemini-providers.ts to use configurable PROVIDER_TIMEOUT_MS (default 45s instead of hardcoded 8s), current Gemini models (gemini-4-hydrogen with gemini-2.5-flash fallback, gemini-embedding-2), and placeholder-key filtering
- Extend Groq (MODEL_CHAT, MODEL_CODING, MODEL_VISION) and OpenRouter fallbacks to all specialist agents (Coding JSON, PDF JSON, PPT JSON, Vision multimodal, Search synthesis, and Image prompt enhancement) instead of Chat only
- Implement real image generation in LiveGeminiImageGenerationProvider via Gemini image models (gemini-3.1-flash-lite-image / gemini-2.5-flash-image), Imagen 3, and Cloudflare Workers AI Flux, preserving actual PNG/JPEG/WebP binary bytes
- Update AgentGraphExecutor (backend/services/agent/src/graph/index.ts) so Search uses lastSynthesizedAnswer / LLM synthesis, RAG generates grounded LLM answers with page citations, and non-generation Coding intents (DEBUGGING, CODE_REVIEW, CODE_EXPLANATION, OPTIMIZATION) call the live LLM
- Add ?inline=1 Content-Disposition and JPEG/WebP extension support on GET /api/v1/artifacts/:artifactId/raw in server.ts and render generated_image artifacts inline with <img> previews in MessageBubble.tsx
- Detect OpenRouter/Cloudflare live keys, enable IMAGE_PROVIDER=live, and honor DAILY_LIVE_CALL_BUDGET in KartikPlatformRuntime
- Add unit tests in backend/services/agent/tests/live-providers-and-limits.test.ts verifying live Search/RAG/Coding synthesis, real Gemini inlineData image decoding, and Groq specialist fallbacks`,
    changedFiles: [
      {
        path: 'backend/services/agent/src/models/index.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=backend/services/agent/src/models/index.ts',
      },
      {
        path: 'backend/services/agent/src/services/live-gemini-providers.ts',
        status: 'modified',
        downloadHref:
          '/__downloads/file?path=backend/services/agent/src/services/live-gemini-providers.ts',
      },
      {
        path: 'backend/services/agent/src/graph/index.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=backend/services/agent/src/graph/index.ts',
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
        path: 'frontend/src/components/chat/MessageBubble.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=frontend/src/components/chat/MessageBubble.tsx',
      },
      {
        path: 'backend/services/agent/tests/live-providers-and-limits.test.ts',
        status: 'modified',
        downloadHref:
          '/__downloads/file?path=backend/services/agent/tests/live-providers-and-limits.test.ts',
      },
      {
        path: 'frontend/src/components/common/StepFileDownloads.tsx',
        status: 'modified',
        downloadHref:
          '/__downloads/file?path=frontend/src/components/common/StepFileDownloads.tsx',
      },
    ],
  },
  {
    id: 'fix-5',
    title: 'Fix #5 — Local Machine .env.example & Environment Preflight (Zero-Dependency Dev Defaults)',
    subtitle:
      '6 files · Fixes .env.example so cp .env.example .env && pnpm dev runs immediately without stalling on fake Neon/Redis/Qdrant/S3 hosts + adds dotenv loading in check:env',
    zipFilename: 'fix-5-local-env-setup.zip',
    zipHref: '/__downloads/fix-5-local-env-setup.zip',
    commitMessage: `fix(env): make .env.example and check-env work cleanly out-of-the-box on local machines

- Replace unreachable placeholder Neon DATABASE_URL, Redis, Qdrant, and S3 defaults in .env.example with zero-dependency local dev defaults (OBJECT_STORAGE_MODE=filesystem, blank optional DATABASE_URL/REDIS_URL/QDRANT_URL, and commented presets for Local Postgres and Neon sslmode=verify-full)
- Add missing runtime environment variables to .env.example (PORT, HOST, GEMINI_API_KEY, MOCK_AI, IMAGE_PROVIDER, DAILY_LIVE_CALL_BUDGET, PGSSL_REJECT_UNAUTHORIZED, PGSSLROOTCERT, VITE_GOOGLE_OAUTH_CLIENT_ID, VITE_GATEWAY_ORIGIN, ALLOW_ROOT_DEMO_RUNTIME)
- Load .env via dotenv in scripts/check-env.mjs CLI entrypoint and prevent blank optional dev variables from clobbering development fallback defaults
- Ignore placeholder DATABASE_URL templates in src/db/platform-repository.ts and honor OBJECT_STORAGE_MODE=filesystem and MOCK_AI=true in src/server/platform-api-runtime.ts
- Allow downloading .env.example via /__downloads/file in server.ts while keeping real .env and dotfiles blocked`,
    changedFiles: [
      {
        path: '.env.example',
        status: 'modified',
        downloadHref: '/__downloads/file?path=.env.example',
      },
      {
        path: 'scripts/check-env.mjs',
        status: 'modified',
        downloadHref: '/__downloads/file?path=scripts/check-env.mjs',
      },
      {
        path: 'src/db/platform-repository.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/db/platform-repository.ts',
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
        path: 'frontend/src/components/common/StepFileDownloads.tsx',
        status: 'modified',
        downloadHref: '/__downloads/file?path=frontend/src/components/common/StepFileDownloads.tsx',
      },
    ],
  },
  {
    id: 'fix-4',
    title: 'Fix #4 — Unify Chat & Billing Domain Logic (Idempotency Fingerprinting & Two-Phase Credit Reservations)',
    subtitle:
      '5 files · Enforces client-owned Idempotency-Key, SHA-256 payload fingerprint conflict detection (409) & two-phase credit reserve/release/settle/execution_unknown state machine',
    zipFilename: 'fix-4-unify-chat-billing-domain-logic.zip',
    zipHref: '/__downloads/fix-4-unify-chat-billing-domain-logic.zip',
    commitMessage: `feat(chat,billing): unify chat and billing domain invariants in KartikPlatformRuntime

- Enforce client-owned Idempotency-Key on POST /api/v1/conversations/:id/messages, POST /api/v1/billing/orders, and POST /api/v1/billing/verify (400 IDEMPOTENCY_KEY_REQUIRED when omitted)
- Compute deterministic SHA-256 payload fingerprints via computePayloadFingerprint from @kartik/shared/contracts and reject reused Idempotency-Keys with mutated payloads (409 IDEMPOTENCY_CONFLICT)
- Replace single-step post-execution credit deduction in KartikPlatformRuntime.sendMessageTurn with a two-phase credit reservation state machine (reserve -> execute -> settle | release | execution_unknown)
- Automatically release reserved credits back to availableCredits on confirmed downstream execution errors, hold credits in reservedCredits on EXECUTION_UNKNOWN timeouts, and add reconcileUnknownTurn
- Persist and hydrate reservedCredits across src/db/platform-repository.ts and KartikPlatformRuntime
- Add unit tests in src/server/platform-multi-user-isolation.test.ts covering missing Idempotency-Key, payload fingerprint conflicts, automatic reservation release, and EXECUTION_UNKNOWN reconciliation`,
    changedFiles: [
      {
        path: 'src/server/platform-api-runtime.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/server/platform-api-runtime.ts',
      },
      {
        path: 'src/db/platform-repository.ts',
        status: 'modified',
        downloadHref: '/__downloads/file?path=src/db/platform-repository.ts',
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
