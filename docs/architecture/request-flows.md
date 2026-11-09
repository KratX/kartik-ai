# Request flows

Placeholder. Authoritative diagrams: Blueprint Section 2.

## Chat turn (the one that matters)

1. Browser `POST /api/v1/chat/messages` with `Idempotency-Key` + session cookie.
2. Gateway introspects the session with Auth, mints a `traceId`, validates the key, forwards a signed user context.
3. Chat persists the user message and an `AgentRun` keyed by `{ userId, requestId }`.
4. Chat asks Billing to reserve credits — Billing computes the amount itself.
5. Chat calls Agent privately with bounded history.
6. Agent runs the router and one specialist node, persists `AgentExecution` + artifacts, returns text, citations, artifact refs and measured usage.
7. Chat persists the assistant message, then settles the reservation.
8. Billing returns the final charge; Chat records the settlement.

Failure paths worth drawing later: provider timeout, ambiguous provider outcome, settle failure → worker retry, deletion arriving mid-run.

## Deletion

`DELETE /conversations/:id` → invisible immediately → worker → `POST /internal/v1/cleanup/conversations/:id` → vectors → objects → metadata → `cleanup_complete`.

## Ingestion

`POST /files/upload-intent` → browser uploads → `POST /files/:id/complete` returns `202` → worker extracts, chunks, embeds, upserts → `GET /files/:id` reports `indexed` or `failed`.
