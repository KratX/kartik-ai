# ADR 0002 — Opaque server-side sessions in HttpOnly cookies

- **Status:** Proposed
- **Date:** 9 November 2026

## Context

Identity comes from Firebase Google sign-in. The application still needs its own session so that services can authorise requests without re-verifying a Firebase ID token on every call, and so that logout and expiry are controllable server-side.

## Options

1. **Trust the Firebase ID token on every request** — no server session. Simple, but revocation is impossible before token expiry and every service needs Firebase Admin.
2. **JWT issued by Auth** — stateless, but logout and forced expiry need a denylist, which reintroduces server state.
3. **Opaque session ID in an HttpOnly cookie, state in Redis** (selected) — random high-entropy ID, server-side record with TTL, immediate revocation.

## Decision

Option 3. Auth issues the session; the Gateway introspects it via a private endpoint and forwards a short-lived signed user context; downstream services verify that assertion and never trust a browser-supplied `userId`.

## Consequences

- **Positive:** logout and expiry are immediate. No upstream token is retained in Redis unless a specific need appears.
- **Positive:** the browser never holds anything readable by JavaScript.
- **Negative:** Redis becomes a hard dependency for authenticated requests — a session-store outage logs everyone out. Accepted and documented; readiness checks must reflect it.
- **Negative:** cookie flags are deployment-dependent. The single-origin deployment (Profile P) keeps this on the simplest branch: host-only cookie, `SameSite=Lax`, `Secure` under HTTPS.
- **Requires:** CSRF/Origin protection for state-changing cookie-authenticated requests.
