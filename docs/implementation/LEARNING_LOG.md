# Kartik.ai Learning Log

---

## Entry 26 — Phase 7 / Step 7.2 (Micro-step 7.2.a): Isolated Browser Code Sandbox (`sandbox="allow-scripts"`) & Grounded Citation Sanitizer

### 1. Concept learned
- **Why `sandbox="allow-scripts"` Must Never Include `allow-same-origin` (`Blueprint §9 Invariant #11 & §11`):**
  - When an `<iframe>` renders untrusted model-generated code via `srcdoc` with `sandbox="allow-scripts"` (and **without** `allow-same-origin`), the browser places the iframe inside a unique, opaque origin (`null`).
  - Even though JavaScript runs inside the preview iframe, it cannot read `document.cookie` (though our session cookie is already `HttpOnly`), cannot read `window.parent.document`, cannot touch `localStorage` or `IndexedDB`, and cannot make authenticated requests as the parent origin.
  - Adding `SANDBOX_CSP_POLICY` (`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'`) inside the `srcdoc` also blocks any outbound network exfiltration (`fetch`, `XMLHttpRequest`, `WebSocket`).
- **Grounded Citations as Data, Never Executable HTML/Links (`Blueprint §10 & §11`):**
  - Retrieved PDF chunks and web search titles are untrusted data. `formatGroundedCitations` escapes all HTML entities (`<`, `>`, `&`, `"`, `'`) and `sanitizeExternalCitationUrl` only allows `https://`, `http://`, or PDF page locators (`p. 14`), blocking `javascript:` and `data:` schemes so a malicious search result can never trigger XSS when clicked.

### 2. What was implemented
- `frontend/src/features/sandbox/index.ts` (`buildSandboxedPreviewDocument`, `validateFrontendArtifactBundle`, `SANDBOX_CSP_POLICY`)
- `frontend/src/features/citations/index.ts` (`formatGroundedCitations`, `sanitizeExternalCitationUrl`)
- `frontend/src/index.ts` (updated exports)
- `frontend/tests/frontend-sandbox-citations.test.ts` (4 unit tests)

### 3. How to inspect the feature
- Run `pnpm test` and inspect `@kartik/frontend Sandboxed Code Preview & Grounded Citations (7.2.a)` (`29` suites, `109` tests passing).

---

## Entry 25 — Phase 7 / Step 7.1 (Micro-step 7.1.a): Frontend Gateway API Client, Client-Owned `Idempotency-Key` & Workspace Store

### 1. Concept learned
- **Single Entry Point & Cookie Security (`Blueprint §9 Invariants #1, #14 & ADR 0002`):**
  - The browser never talks directly to Auth (`4001`), Chat (`4002`), Agent (`4003`), or Billing (`4004`), and is strictly forbidden from calling `/internal/*`.
  - Every request passes through `KartikGatewayClient` to `/api/v1/*` with `credentials: 'include'` so the browser attaches the `HttpOnly` session cookie automatically while client-side JavaScript never sees or stores raw session tokens.
