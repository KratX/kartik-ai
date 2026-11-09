# Cost and quota model

**Verified:** 9 November 2026. **Re-check every figure in the provider console before provisioning** — free allowances change without notice, including mid-project.

## Headline

| | |
|---|---|
| Recurring infrastructure cost | **₹0** |
| Optional spend | Domain, ~₹800/year |
| Binding constraint | **Provider quota**, not money |
| Billable exercise | AWS sprint, ~$35–40 for 14 days, then torn down |

## Architecture choice

AWS cannot host the permanent demo: new accounts get a 6-month / $100–200 credit Free plan, and the tutorial's ECS stack runs ~$110–130/month — about 7–8 weeks of credits. The permanent demo therefore runs on one Oracle Always Free ARM VM (2 OCPU / 12 GB), with a managed-free profile as fallback and a bounded AWS sprint for the ECS artifacts.

Full reasoning: [ADR 0003](decisions/0003-free-tier-deployment.md).

## Verified inventory

| Layer | Free option | Allowance | Main caveat |
|---|---|---|---|
| Compute | Oracle Always Free A1 | 2 OCPU / 12 GB ARM, 200 GB disk, ~10 TB/mo egress | Card required (not charged); idle reclamation; capacity at creation |
| Compute | AWS Free plan | $100 credits (+$100), **6 months max** | Account closes after 6 months or when credits end |
| Compute | Render free | 512 MB / 0.1 CPU, 750 h/mo | Sleeps after 15 min idle |
| Database | Neon Postgres free (0.5 GB, 100 CU-hours/mo) | Compute-bound, not storage-bound | Scale-to-zero keeps it free; an always-open pool does not |
| Database | Atlas Free (M0) | 512 MB, 100 ops/s | Shared tier; not used for Billing |
| Cache/session | Redis on the VM | RAM-bound | You own persistence config |
| Cache/session | Upstash free | 500 K commands/mo | Sessions + rate limits consume this quickly |
| Vectors | Qdrant on the VM | RAM/disk-bound | — |
| Vectors | Qdrant Cloud free | 1 GB, ~250 K vectors @768 | Suspends after ~1 week idle |
| Objects | Cloudflare R2 | 10 GB, 1 M writes, 10 M reads, **$0 egress** | Standard class only |
| DNS/TLS/CDN | Cloudflare free | DNS, universal TLS, CDN, basic WAF | — |
| Chat/router | Groq free | ~30 RPM, ~1,000 req/day, ~200 K tokens/day per model | Limits vary per model |
| Embeddings + images | Cloudflare Workers AI | 10,000 Neurons/day | Shared daily pool |
| Search | Tavily | Free plan with a monthly credit cap | Confirm the current cap in the dashboard |
| Payments | Razorpay test mode | Free and unlimited | Live mode has fees; never enabled on a public demo |

## Quota policy (the part that actually protects the demo)

1. `AI_PROVIDER_MODE=mock` is the default for every request.
2. Global per-provider daily budget counters, hard-capped in config, checked before each live call.
3. Layered limits: per-IP (unauthenticated) → per-user → per-agent → global.
4. `DEMO_READ_ONLY=true` kill switch for mutating endpoints.
5. Seeded demo tenant so a first visit never waits on a live model.
6. Upload caps, per-user daily ingestion cap, artifact expiry and a cleanup job.
7. Separate API keys for demo and local development; rotate anything that appears in a screenshot, log or commit.

## Review cadence

- Daily for the first week after deployment, then weekly.
- Check the provider dashboards (Groq, Tavily, Cloudflare), the VM's disk and memory, and the R2 usage.
- During the AWS sprint only: check AWS Budgets and Cost Explorer daily; verify $0 the day after teardown and again three days later.
