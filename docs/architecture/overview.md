# Architecture overview

Source of truth: Blueprint Section 2. This file summarises it so the repository can be understood without opening the full document.

## Services

| Service | Port | Owns | Must not |
|---|---|---|---|
| Gateway | 8000 | Routing, CORS, trace IDs, run-identity validation, rate-limit enforcement | Contain business logic |
| Auth | 8001 | User identity, application sessions (Redis) | Touch credits or payments |
| Chat | 8002 | Conversations, messages, `AgentRun` lifecycle, deletion coordination, billing orchestration | Write Agent collections or mutate the ledger |
| Agent | 8003 | LangGraph execution, specialist agents, artifacts, uploaded files, objects, vectors | Calculate, reserve or settle credits; call Chat |
| Billing | 8004 | Plans, entitlements, credit accounts, reservations, ledger, payments, quota policy | Trust a caller-supplied amount |

## Request flow (one chat turn)

```
Browser → Gateway (session introspection → signed user context + traceId)
        → Chat (persist user message + AgentRun, keyed by client requestId)
            → Billing (reserve by requestId + agent + operation)
            → Agent (execute, persist AgentExecution + artifacts, return usage)
        → Chat (persist assistant message + artifact refs)
            → Billing (settle idempotently)
        → Browser
```

Billing work that fails is retried by Chat's recovery worker from durable state. There is no cross-service database transaction.

## Non-negotiables

1. The browser talks only to the Gateway.
2. Services never read or write another service's collections.
3. Every query filters by the authenticated `userId`.
4. A request ID identifies one logical run; retries must not duplicate messages, artifacts or charges.
5. Objects are private; the browser gets short-lived, ownership-checked URLs.
6. Generated code is never executed on the backend host.
7. All model output is untrusted input and is schema-validated.

## Where things live

- Contracts and data model: Blueprint Section 5 (pull requests to `docs/api/openapi.yaml` must keep it in sync).
- Deployment: [ADR 0003](../decisions/0003-free-tier-deployment.md) and `docs/runbooks/deployment.md`.
- Cost and quota: [COST.md](../COST.md).
