# Kartik.ai Build State

- Current phase: Phase 9 — Multi-Agent Platform Completion (Blueprint v4.3 Phases 6–18 & Video Tutorial Alignment)
- Current step / micro-step: 9.2.a
- Status: complete
- Last completed micro-step: 9.2.a (Live Server-Side `@google/genai` AI Providers, 2-Stage Coding Intent Classifier, Real Binary PDF RAG Loader & Per-Agent Sliding-Window Rate Limiter)
- Next micro-step: 9.3.a (Full-Stack Express + Vite Server `server.ts` on Port 3000 Mounting Real `/api/v1/*` Routes, Binary File Uploads & Binary Artifact Downloads)
- Current branch: main
- Last known commit: feat(agent): add live gemini providers, pdf binary loader, coding intent classifier and per-agent rate limiter (9.2.a)

## Current objective
Complete **Kartik.ai** across micro-steps `9.1.a`–`9.6.a` so every specialist capability (`chat`, `search`, `coding`, `pdf`, `ppt`, `image`, `vision`), live server-side AI provider, full-stack Port 3000 server, and 3-pane Multi-Agent Workspace UI is 100% aligned with Blueprint v4.3 and the 3-part reference tutorial.

## Completed work
- Phases 0–8: Core Monorepo, Shared Contracts, Auth, Gateway, Billing, Agent, Chat, Frontend & Readiness Suites (`Complete`)
- Phase 9 / `9.1.a`: Canonical 7-Agent Contract with `pdf` & `ppt`, Pricing Table, and Real Binary PDF 1.4 & OpenXML `.pptx` Generators (`Complete`)
- Phase 9 / `9.2.a`:
  - Created `backend/services/agent/src/services/agent-rate-limiter.ts` (`AGENT_RATE_LIMITS_PER_MINUTE`: `chat: 20/min`, `coding: 5/min`, `pdf: 5/min`, `ppt: 5/min`, `rag: 5/min`, `vision: 5/min`, `image: 5/min`, `search: 5/min`, `InMemoryAgentRateLimitStore`, and `AgentSlidingWindowRateLimiter.checkAgentLimit`).
  - Created `backend/services/agent/src/rag/loaders/index.ts` (`extractTextPagesFromPdfBytes` parsing real `%PDF-1.x` binary and `FlateDecode` streams into `{ pageNumber, text }[]`) and wired it into `FileIngestionAndArtifactService.ingestUploadedFile` (`backend/services/agent/src/rag/index.ts`).
  - Created `backend/services/agent/src/agents/coding/index.ts` (`classifyCodingIntent` classifying `CODE_GENERATION` vs `CODE_REVIEW` / `CODE_EXPLANATION` / `DEBUGGING` / `OPTIMIZATION`, `buildRichCodingTemplateBundle`, and `buildNonGenerationCodingMarkdown`) and wired it into `AgentGraphExecutor` (`backend/services/agent/src/graph/index.ts`).
  - Created `backend/services/agent/src/services/live-gemini-providers.ts` (`LiveGeminiChatModelProvider`, `LiveGeminiCodingModelProvider`, `LiveGeminiSearchProvider` with `googleSearch` grounding + `SearchImageGalleryItem[]`, `LiveGeminiEmbeddingProvider` with `gemini-embedding-2`, `LiveGeminiVisionProvider` with `inlineData`, `LiveGeminiPdfDocumentProvider`, `LiveGeminiPptPresentationProvider`, `LiveGeminiImageGenerationProvider`).
  - Created `backend/services/agent/tests/live-providers-and-limits.test.ts` (`4/4` tests passing).

## Changed files (Micro-step 9.2.a)
- `backend/shared/redis/index.ts` (updated)
- `backend/services/agent/package.json` (updated)
- `backend/services/agent/src/services/agent-rate-limiter.ts` (created)
- `backend/services/agent/src/rag/loaders/index.ts` (created)
- `backend/services/agent/src/rag/index.ts` (updated)
- `backend/services/agent/src/agents/coding/index.ts` (created)
- `backend/services/agent/src/services/live-gemini-providers.ts` (created)
- `backend/services/agent/src/graph/index.ts` (updated)
- `backend/services/agent/src/index.ts` (updated)
- `backend/services/agent/tests/live-providers-and-limits.test.ts` (created)
- `docs/implementation/BUILD_STATE.md` (updated)
- `docs/implementation/TEST_EVIDENCE.md` (updated)
- `docs/implementation/LEARNING_LOG.md` (updated)

## Verification evidence
- `pnpm test` (`38` suites, `139` tests passing across all 7 workspaces, `0` failures) — **PASS**

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None.

## Safe resume instruction
Resume at **Phase 9, micro-step 9.3.a**: implement the full-stack Express + Vite server (`server.ts` on Port 3000) mounting real `/api/v1/*` routes (`Gateway` → `Auth`, `Chat`, `Agent`, `Billing`), binary file upload (`POST /api/v1/files/upload`), and binary artifact download (`GET /api/v1/artifacts/:id/raw`) for `.pdf`, `.pptx`, and images.
