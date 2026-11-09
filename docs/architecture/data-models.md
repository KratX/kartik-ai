# Data models

Placeholder. Authoritative schemas: Blueprint Section 5.1; API: `docs/api/openapi.yaml`.

## Ownership

| Collection | Owner | Key rule |
|---|---|---|
| `User` | Auth | No plan or balance fields |
| `Conversation`, `Message`, `AgentRun` | Chat | Every query filtered by `userId`; soft-delete via `deletionState` |
| `Artifact`, `UploadedFile`, `AgentExecution` | Agent | Unique `{ userId, requestId }` on executions |
| `PlanEntitlement`, `CreditAccount`, `CreditReservation`, `CreditLedger`, payments | Billing | Atomic, idempotent, append-only ledger |

One PostgreSQL database, `kartik`, with four schemas (`auth`, `chat`, `agent`, `billing`) — one login role per service, granted exactly one schema. Sharing the instance is a cost decision; it is not permission to cross-write. See ADR 0004 and Blueprint §5.1 for the DDL.

## Rules that bite

- Credit mutations need a transaction → every balance change runs inside `BEGIN … COMMIT` with the balance row locked by `SELECT … FOR UPDATE`. Transactions are the floor here, not a mode to enable.
- Never put a TTL index on financial records.
- Never add a plain unique index on a nullable field (`requestId`, `providerPaymentId`) — use a partial index or keep uniqueness in the parent record.
