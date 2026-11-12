# Deployment runbook — Profile P (ARM VM + Single-Origin Reverse Proxy)

Operational deployment procedure for **Kartik.ai** under Profile P (Blueprint v4.4 §3.4 & Free-Tier Portfolio Addendum). Designed to stay within available free allowances, subject to current eligibility and usage.

## Pre-deployment Verification Gate

Before deploying to any target host, run the automated release checks locally or via `.github/workflows/deploy-demo-vm.yml`:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
node scripts/check-env.mjs
node scripts/migrate.mjs
```

## 15-Step Procedure

1. Provision an Always Free ARM64 VM instance (2 OCPU / 12 GB RAM), home region, Ubuntu LTS.
2. Security list: TCP `22` from your admin IP only; TCP `80`/`443` from the internet. No internal service ports (`8001–8004`, `5432`, `6379`, `6333`, `9000`) are ever published.
3. Confirm host firewall (`ufw` / `nftables`) matches the cloud security list.
4. Install Docker Engine 29+ and Docker Compose v5+ from Docker's official apt repository.
5. Clone the repository and create `.env` with `chmod 600`. Ensure `MOCK_AI=true`, `IMAGE_PROVIDER=mock`, and `BILLING_MODE=mock` (never use `rzp_live_*` keys on a public deployment).
6. Build ARM64 images on the host or pull immutable SHA tags.
7. Run `node scripts/check-env.mjs` and `node scripts/migrate.mjs` to validate the ordered 4-schema PostgreSQL DDL (`auth`, `chat`, `agent`, `billing`).
8. Start the internal services (`auth`, `chat`, `agent`, `billing`) and `gateway` on the private Compose network; verify `/readyz` inside the network.
9. Mount `infra/nginx/default.conf` in the edge Nginx container so `/` serves the SPA and `/api/*` + `/healthz` + `/readyz` proxy exclusively to `http://gateway:8000`.
10. Configure Cloudflare DNS + TLS in Strict mode; confirm the `kartik_session` cookie carries `HttpOnly`, `Secure`, and `SameSite=Lax`.
11. Run smoke tests: `/healthz`, `/readyz`, mock Google sign-in, idempotent chat turn, and credit balance check.
12. Record the deployed Git SHA, timestamp, and verification output in `docs/implementation/BUILD_STATE.md`.
13. Configure nightly `pg_dump --format=custom` backup and test restoration in a disposable database.
14. Rehearse rollback to the previous image tag using `docs/runbooks/rollback.md`.
15. Enable `.github/workflows/keepalive.yml` with `vars.DEMO_URL` set so `/health/live` is pinged every 10 minutes.

## Known Operational Traps

- **`exec format error`** — x86_64 images deployed onto an ARM64 host. Always build for `linux/arm64` on Profile P.
- **Health check times out** — cloud security list and host firewall (`ufw`) disagree.
- **Instance reclaimed as idle** — keep-alive workflow not enabled or `DEMO_URL` variable unset.
- **Cookies not set** — Nginx missing `proxy_pass_header Set-Cookie;` or origin mismatch (see `infra/nginx/default.conf`).
