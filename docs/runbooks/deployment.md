# Deployment runbook — Profile P (free ARM VM)

Placeholder. The authoritative 15-step procedure is Phase 16 of the Blueprint. This file becomes the operational version, with the real hostnames, paths and commands, once the deployment exists.

## Outline

1. Provision an Always Free A1 instance (2 OCPU / 12 GB), home region, Ubuntu LTS.
2. Security list: 22 from your IP only; 80/443 from the internet. Nothing else.
3. Host firewall must agree with the security list.
4. Docker Engine + Compose plugin from Docker's repository.
5. Clone the repo; create the environment file with `chmod 600`.
6. Images: build on the host, or pull immutable SHA tags. **ARM64 either way.**
7. Set `DIRECT_DATABASE_URL` (unpooled) and `DATABASE_URL` (pooled) against the Neon project; run the migration runner; then start Redis, Qdrant, MinIO.
8. Start the five services with no published host ports; check `/health/ready` inside the network.
9. Reverse proxy: frontend for non-`/api` paths, `/api/*` to the Gateway. One origin.
10. Cloudflare DNS + TLS; confirm the session cookie is `Secure`.
11. Smoke test, including one deliberate failure.
12. Record SHA, timestamp and result in `BUILD_STATE.md`.
13. Nightly `pg_dump --format=custom` to private R2. **Test the restore.** Neon's own 6-hour restore window does not cover a weekend.
14. Rehearse rollback to the previous image tag.
15. Confirm the keep-alive workflow is green.

## Known traps

- **`exec format error`** — you built x86 images for an ARM host.
- **Health check times out** — cloud security list and host firewall disagree.
- **Instance reclaimed as idle** — keep-alive not running.
- **Cookies not set** — proxy not forwarding `Set-Cookie`, or origin mismatch between the proxied frontend and API.
