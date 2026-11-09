# Engineering decisions worth explaining

A short index for reviewers. Each item links to the artifact that shows the work.

## What this project is

A multi-agent AI workspace: Google sign-in, persistent conversations, a LangGraph router that dispatches to seven specialist capabilities (chat, search, coding, PDF, PPT, image, vision), generated artifacts, PDF retrieval-augmented answering, and a credit ledger with idempotent reservations. Five backend services behind one gateway.

## The six decisions most worth asking about

1. **Five services, one gateway — on purpose.** The interesting problems (ownership across services, idempotent retries, a saga for money) only exist if the boundaries are real. See [ADR 0001](decisions/0001-monorepo.md) and Section 2 of the blueprint.
2. **Credit reservations instead of direct debits.** A model call can be expensive and can fail ambiguously, so credits are held before execution, settled after the result is durable, and released on confirmed failure. Ledger arithmetic reconciles exactly in every case.
3. **Two identifiers, never confused.** `requestId` comes from the client's `Idempotency-Key` and defines a logical run; `traceId` is generated at the gateway for logs. Conflating them is how systems double-charge on a retry.
4. **Mock by default.** Every provider sits behind an adapter, and mock mode is the default so the whole product can be tested without spending quota or money.
5. **Single-host by choice, ECS by exercise.** AWS's 2026 terms make a permanent free host impossible; the demo runs on a free ARM VM and the ECS architecture was built, costed and torn down deliberately. See [ADR 0003](decisions/0003-free-tier-deployment.md) and [COST.md](COST.md).
6. **Deletion is a cascade, not a flag.** Deleting a conversation marks it invisible, then a worker deletes vectors, then objects, then metadata — in that order — and reports complete only on confirmation.

## What to look at first

- [ ] `docs/architecture/overview.md` — service map and request flow
- [ ] `docs/COST.md` — the free-tier model
- [ ] `docs/implementation/BUILD_STATE.md` — where the build actually is
- [ ] `docs/implementation/TEST_EVIDENCE.md` — real test runs, not claims
- [ ] `docs/aws-sprint/` — the ECS exercise and its measured cost

## Honest limitations

*Fill this in as the build progresses. Reviewers trust a project that states its own limits.*

- Single host, no high availability.
- *(add each limitation as it is identified — the goal is an accurate list, not a short one.)*
