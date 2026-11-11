# Kartik.ai Learning Log

---

## Entry 18 — Phase 5 / Step 5.1 (Micro-step 5.1.a): Agent Config (`MOCK_AI=true`), Provider Interfaces & `userId`-Isolated Vector Store

### 1. Concept learned
- **Deterministic Mock-First AI Architecture & Tenant-Isolated Vector Search (Blueprint §10, §12, Invariants #4, #9, #13, #19):**
  - **Mock-First Default (`MOCK_AI=true`, `IMAGE_PROVIDER=mock`):** Every AI specialist (`chat`, `coding`, `search`, `embedding`, `image`, `vision`) sits behind an explicit TypeScript interface (`ChatModelProvider`, `CodingModelProvider`, `SearchProvider`, `EmbeddingProvider`, `ImageGenerationProvider`, `VisionProvider`, `VectorStore`). By default, Agent runs deterministic mock implementations so local development, CI, and integration tests consume zero external API quota.
  - **Tenant-Scoped Vector Retrieval (Invariant #9):** Unlike a traditional SQL table where a query hits one row by primary key, vector similarity search compares a query embedding against stored chunk vectors. If tenant filtering happens *after* top-K similarity scoring, another user's chunks could crowd out the caller's results or leak across tenants. Therefore, `VectorStore.searchChunks` filters strictly by `chunk.userId === input.userId` (and optional `fileIds`) **before** computing cosine similarity.

### 2. What was implemented
- `backend/services/agent/src/config/index.ts` (`loadAgentConfig`)
- `backend/services/agent/src/models/index.ts` (`AGENT_INITIAL_MIGRATION` `0001_agent_core.sql` + provider interfaces)
- `backend/services/agent/src/services/mock-providers.ts` (`MockChatModelProvider`, `MockCodingModelProvider`, `MockSearchProvider`, `MockEmbeddingProvider`, `MockImageGenerationProvider`, `MockVisionProvider`, `InMemoryVectorStore`)
- `backend/services/agent/tests/agent-foundation.test.ts` (4 unit tests)

### 3. How to inspect the feature
- Run `pnpm test` and inspect the `@kartik/agent config, 0001_agent_core migration & deterministic mock providers (5.1.a)` suite.
