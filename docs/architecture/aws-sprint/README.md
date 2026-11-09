# AWS sprint evidence

Filled in during the 14-day Profile S exercise. Nothing here exists until the sprint runs.

## Expected contents

| File | What it proves |
|---|---|
| `architecture.md` | CloudFront → ALB → ECS diagram and the security-group matrix |
| `cost.csv` | Measured daily run-rate from Cost Explorer (not an estimate) |
| `cost-screenshot.png` | The console view, filtered by `project=kartik-ai` |
| `task-definitions/` | Five exported task definitions, secrets redacted to ARNs |
| `ci-run.png` | The green workflow run that pushed the image and forced a deployment |
| `failure-drill.md` | A stopped task replaced, with timestamps |
| `teardown-log.md` | Each teardown step with the time it completed, plus the $0 verification |

## Rules

- Run in mock mode. AWS is the only thing you are paying to learn.
- Budgets and Cost Anomaly Detection on before any resource is created.
- There is no day 11: screenshots on day 9, teardown on day 10, verify $0 the next day and again three days later.
