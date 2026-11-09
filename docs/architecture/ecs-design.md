# ECS / ALB / CloudFront design (Profile S)

**Status:** placeholder — completed during the AWS sprint.

This document records the tutorial's advanced architecture as a **design and cost exercise**, not a deployment. It is written during the 14-day sprint and must end with a teardown verification.

## To be completed during the sprint

1. Diagram: CloudFront (S3 default origin, `/api/*` → ALB) → ALB → ECS Fargate services on Graviton.
2. Security-group matrix: which service accepts traffic from which source, and nothing more.
3. **Measured** cost table from Cost Explorer — not an estimate.
4. Failure drill: a stopped task is replaced; health check behaviour recorded with timestamps.
5. Explicit statement of why the permanent demo is not hosted here.

## Known starting point (estimates to be replaced by measurements)

| Resource | Sizing | Approx/month |
|---|---|---|
| Fargate ARM64 × 5 | 0.25 vCPU / 0.5 GB | ~$36 |
| ALB | 1 + modest LCU | ~$17–20 |
| Public IPv4 × 5 | $0.005/hr each | ~$18 |
| CloudFront + S3 + ECR + logs | small | ~$5 |
| **Total** | | **~$75–80** |

Add NAT Gateway and ElastiCache and it becomes ~$110–130/month — which is the number that makes this a sprint and not a home.
