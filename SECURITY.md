# Security policy

## Reporting

Do not open a public issue for a vulnerability. Contact the repository owner privately and include reproduction steps.

## Rules this project follows

- Every resource query filters by the authenticated `userId`. Foreign and missing resources both return `404`, so ownership cannot be probed.
- Firebase ID tokens are verified server-side. Client-supplied `userId`, email, role, credit balance or plan is never trusted.
- Sessions are opaque, high-entropy IDs in `HttpOnly` cookies with server-side state and a TTL.
- All secrets live in environment files or a secret manager. None are committed, baked into images, or sent to the browser.
- Object storage is private; the browser receives short-lived URLs only after an ownership check.
- Generated code is rendered in a sandboxed iframe and never executed on the backend host.
- Payment signatures are verified server-side with constant-time comparison: checkout signature with the key secret, webhook signature against the raw body with the webhook secret.
- Razorpay stays in test mode; live keys are never enabled on a public deployment.
- Rate limits fail **closed** for paid operations: if the limiter is unavailable, return `503` rather than allowing unlimited throughput.

## Accepted risks

See [`docs/PORTFOLIO.md`](docs/PORTFOLIO.md) and the threat model in `docs/architecture/`.
