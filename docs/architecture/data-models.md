# Data models & schema ownership

Authoritative data model and schema isolation reference for **Kartik.ai** (Blueprint v4.4 §5.1, ADR 0004, and `scripts/migrate.mjs`).

## Service Schema Ownership (`postgres:17-alpine` / database `kartik`)

| Schema | Owning Service | Tables | Key Invariants |
|---|---|---|---|
| `auth` | `@kartik/auth` | `auth.users` | Owns identity (`user_id`, `firebase_uid`, `email`, `display_name`). Contains zero plan, credit, or payment columns (Invariant #2). |
| `chat` | `@kartik/chat` | `chat.conversations`, `chat.messages`, `chat.agent_runs` | Every query filtered by `user_id`; soft-delete lifecycle (`active` $\rightarrow$ `deleting` $\rightarrow$ `purged`); unique `(user_id, request_id)` on `chat.agent_runs` (Invariant #3 & #15). |
| `agent` | `@kartik/agent` | `agent.uploaded_files`, `agent.artifacts`, `agent.executions` | Unique `(user_id, request_id)` on `agent.executions`; server-generated object storage keys; vector retrieval strictly filtered by `userId` and `fileId` (Invariant #4 & #9). |
| `billing` | `@kartik/billing` | `billing.credit_accounts`, `billing.credit_reservations`, `billing.credit_ledger`, `billing.payment_orders` | Atomic `BEGIN … SELECT … FOR UPDATE … COMMIT` mutations; integer `amount_paise` only; append-only `credit_ledger`; unique idempotency keys (Invariant #5, #6, #17). |

One PostgreSQL database (`kartik`) hosts the four isolated schemas (`auth`, `chat`, `agent`, `billing`) with least-privilege roles (`kartik_auth_role`, `kartik_chat_role`, `kartik_agent_role`, `kartik_billing_role`). Services never read or write another service's schema (Invariant #7). Inspect or execute the DDL migration plan via `node scripts/migrate.mjs`.

## Rules That Protect Financial & Tenant Integrity

1. **Row-level locking for credit mutations**: Every credit reservation, settlement, release, or grant locks the `billing.credit_accounts` row (`SELECT … FOR UPDATE`) inside a transaction and enforces `CHECK (available_credits >= 0 AND reserved_credits >= 0)`.
2. **No TTL on financial records**: `billing.credit_ledger`, `billing.credit_reservations`, and `billing.payment_orders` are permanent audit trails; Redis is never the authoritative store for balances (Invariant #16).
3. **Cross-tenant `404 NOT_FOUND` masking**: Looking up a resource that does not exist or belongs to another `user_id` returns `404 NOT_FOUND` (`403 FORBIDDEN` is reserved for actions refused on a resource the caller does own — Invariant #20).
