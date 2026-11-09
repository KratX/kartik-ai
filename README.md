# Kartik.ai

A multi-agent AI workspace: Google sign-in, persistent conversations, a LangGraph router that dispatches to seven specialist capabilities, generated artifacts, document-grounded answering, and a credit ledger with idempotent reservations.

Five backend services behind one gateway, built in small verified increments.

## Status

**Phase 0 — project setup.** The repository skeleton and project records exist; no application code yet. Live progress: [`docs/implementation/BUILD_STATE.md`](docs/implementation/BUILD_STATE.md).

## Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite |
| Backend | Node.js (LTS), Express |
| Data | PostgreSQL 17 (ADR 0004), Redis, Qdrant, MinIO locally / Cloudflare R2 in the cloud |
| AI | LangChain + LangGraph, provider adapters with a mock mode |
| Auth | Firebase Google sign-in → opaque session in an HttpOnly cookie |
| Payments | Razorpay, **test mode only** |
| Deployment | Docker Compose on one free ARM VM (see [`docs/COST.md`](docs/COST.md)) |

## Services

| Service | Port | Owns |
|---|---|---|
| Gateway | 8000 | Routing, CORS, trace IDs, run-identity validation |
| Auth | 8001 | Identity and sessions |
| Chat | 8002 | Conversations, messages, run lifecycle, billing orchestration |
| Agent | 8003 | LangGraph, agents, artifacts, files, vectors |
| Billing | 8004 | Plans, credits, ledger, payments |

Details: [`docs/architecture/overview.md`](docs/architecture/overview.md).

## Getting started

```bash
# 1. Confirm your toolchain (Node, pnpm, Docker, Git)
node -v && pnpm -v && docker compose version && git --version

# 2. Install dependencies (per app — see the blueprint's Phase 1)
#    Local infrastructure arrives in Phase 2.
```

Local development instructions become complete in Phase 2 — see [`docs/runbooks/local-development.md`](docs/runbooks/local-development.md).

## Cost

The target is **₹0 recurring**. The permanent demo runs on a free ARM VM; the AWS ECS architecture is a bounded, costed exercise that is torn down. Full model, including the 2026 changes to AWS and Oracle free tiers: [`docs/COST.md`](docs/COST.md).

## Documentation

| Document | What it is |
|---|---|
| [`docs/architecture/overview.md`](docs/architecture/overview.md) | Services, ownership, request flow, non-negotiables |
| [`docs/api/openapi.yaml`](docs/api/openapi.yaml) | Public API contract |
| [`docs/decisions/`](docs/decisions/) | Architecture decision records |
| [`docs/implementation/`](docs/implementation/) | Build state, learning log, test evidence, phase checklist |
| [`docs/COST.md`](docs/COST.md) | Free-tier inventory and quota policy |
| [`docs/PORTFOLIO.md`](docs/PORTFOLIO.md) | Engineering decisions worth explaining |
| [`docs/runbooks/`](docs/runbooks/) | Deployment, rollback, teardown |

## Honest limitations

- Single host, no high availability.
- Auth sessions depend on Redis; a session-store outage signs everyone out.
- *(expanded as the build progresses — see [`docs/PORTFOLIO.md`](docs/PORTFOLIO.md))*

## License

Not yet chosen.
