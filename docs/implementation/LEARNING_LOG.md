# Kartik.ai Learning Log

---

## Entry 20 — Phase 5 / Step 5.3 (Micro-step 5.3.a): File Upload Magic-Byte Validation, PDF Chunking & Ordered Cascade Purge (`vectors -> objects -> metadata`)

### 1. Concept learned
- **Soft Delete vs Purge & Cascade Order (`vectors -> objects -> metadata`, Invariant #18):**
  - **Soft delete vs purge:** *Soft delete* marks a conversation or file as `deleted` / `purging` so it disappears from user queries immediately while background cleanup runs. *Purge* permanently removes the underlying storage resources.
  - **Why deletion must cascade `vectors -> objects -> metadata` (Invariant #18):** If you delete the database metadata row *first* and the process crashes before deleting the Qdrant vectors or R2/MinIO objects, you lose the `fileId` and `storageKey` pointers—leaving orphaned vectors in Qdrant (which could still surface in `userId`-wide RAG searches!) and orphaned billable blobs in R2/MinIO forever. Deleting **vectors first**, **objects second**, and **metadata last** guarantees that if any earlier step fails, the metadata record still exists so a retry can finish the cleanup cleanly!

### 2. What was implemented
- `backend/services/agent/src/repositories/index.ts` (`InMemoryAgentRepository`, `PostgresAgentRepository`)
- `backend/services/agent/src/rag/index.ts` (`chunkPdfPages`, `FileIngestionAndArtifactService`)
- `backend/services/agent/tests/agent-ingestion-purge.test.ts` (4 unit tests)

### 3. How to inspect the feature
- Run `pnpm test` and inspect the `@kartik/agent File Upload Validation, PDF RAG Ingestion & Cascade Purge (5.3.a)` suite.
