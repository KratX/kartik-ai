# Threat model (initial)

Placeholder — expanded in Phase 17. Structure: asset, threat, mitigation, residual risk.

| Asset | Threat | Mitigation | Residual risk |
|---|---|---|---|
| User conversations | Cross-user read via a guessed ID | Every query filters by `userId`; foreign IDs return 404 | Accepted, tested |
| Uploaded documents | Cross-user retrieval through the vector store | Qdrant filter on `userId` + document; isolation tests | Depends on filter correctness |
| Generated code | Backend compromise by executing model output | Browser sandbox only, no `allow-same-origin`, `connect-src 'none'` | Preview escape via browser bug |
| Credits and payments | Free credits by replay | Signature verification, idempotency keys, unique provider IDs, ledger | Provider-side disputes |
| Provider API keys | Quota theft on a public demo | Mock default, global budget caps, read-only kill switch, separate keys | A determined abuser before caps trigger |
| Session cookies | Theft via XSS | HttpOnly, no token in JS, CSP, sanitised markdown | XSS in a dependency |
| Internal services | Direct access bypassing the gateway | No published ports, service credentials, signed user context | Host compromise |
| Webhook endpoint | Forged credit grants | HMAC over the raw body with a separate secret, constant-time compare | — |
| Prompt injection | Retrieved text steering the model | System/user/retrieved separation, tool allow-list, output validation | Partial, by nature |
