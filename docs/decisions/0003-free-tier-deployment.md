# ADR 0003 — Free-tier deployment profile

- **Status:** Accepted
- **Date:** 9 November 2026
- **Supersedes:** the "eligible small free EC2 host" assumption in earlier drafts

## Context

This is a portfolio project with a hard requirement of ₹0 recurring cost, and it must stay reachable so that a reviewer clicking the link sees a working product. Two 2026 changes invalidate the assumptions common in tutorials:

- AWS no longer offers a permanent free EC2 instance to new accounts. A new account receives a **Free account plan**: $100 of credits (up to $200 through activities), lasting **at most six months or until credits are exhausted**, after which the account closes unless upgraded. Always Free allowances cover request-counted services, not always-on container hosts.
- Oracle Always Free Ampere A1 was **halved to 2 OCPU / 12 GB** (June 2026, enforced August 2026).

The Part 3 stack (five Fargate tasks, ALB, NAT Gateway, ElastiCache, ECR, public IPv4s, logs) costs roughly **$110–130/month**, which exhausts a $200 credit pool in about **7–8 weeks**.

## Options

1. **Profile B — managed free tiers.** App in one 512 MB container with managed Postgres/Redis/Qdrant/R2. Free, but sleeps after 15 minutes idle, cold-starts in ~30–60 s, and puts the frontend and API on different origins.
2. **Profile P — one free ARM VM** (selected). The same Docker Compose stack on an Always Free A1 instance, with Cloudflare for DNS/TLS/CDN.
3. **Profile C — the tutorial's ECS/ALB/CloudFront.** Correct architecture, wrong budget: bounded by credits and by a six-month account life.

## Decision

Option 2 for the permanent demo. Option 3 is retained as **Profile S**, a 14-day time-boxed sprint that produces the ECS artifacts and a measured cost table, then is torn down. Option 1 is insurance only.

## Consequences

- **Positive:** no cold start, no quota sharing, one browser origin, and real operational evidence (Docker, proxy, TLS, health checks, backup, rollback).
- **Positive:** memory fits comfortably — roughly 1.5–2 GB of the 12 GB available.
- **Negative:** the VM is ARM64, so images must be built for `linux/arm64`.
- **Negative:** an Always Free instance can be reclaimed if CPU, network and memory all stay under 20% for seven days. Mitigated by a scheduled health ping and off-box backups.
- **Negative:** a single host is not highly available. Stated plainly in the README rather than implied otherwise.
- **Revisit when:** the project needs availability, or a paid budget is approved.
