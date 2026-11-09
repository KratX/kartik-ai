# Start here

This folder is the **Phase 0 scaffold** produced from Blueprint Section 4.1. It contains directories and project records — deliberately **no application code**. Phase 1 adds the skeleton; Phase 2 adds local infrastructure.

## What exists

| Thing | Where | State |
|---|---|---|
| Repository skeleton | whole tree | 107 directories, matching the blueprint |
| Project records | `docs/implementation/` | Templates, `BUILD_STATE.md` filled to "Phase 0 in progress" |
| Decision records | `docs/decisions/` | `0000` baseline (needs your environment facts), `0001`–`0003` proposed |
| Architecture docs | `docs/architecture/` | Overview is real; the rest are structured placeholders |
| API contract | `docs/api/openapi.yaml` | 22 paths, 25 operations, validates as YAML |
| Cost model | `docs/COST.md` | Verified inventory, quota policy, review cadence |
| Portfolio page | `docs/PORTFOLIO.md` | The six decisions worth explaining |
| Env template | `.env.example` | Every variable from §6.2, placeholders only |
| CI/CD | `.github/workflows/` | Placeholders + a working keep-alive |

## Your first five minutes

```bash
cd kartik-ai
git init -b main
node -v && pnpm -v && docker compose version && git --version
```

Then fill in the **Verified facts** table in `docs/decisions/0000-project-baseline.md` with what those commands print, and update the first four lines of `docs/implementation/BUILD_STATE.md`.

## What not to do yet

- Don't run `npm init`, `pnpm init` or add dependencies — that's Phase 1. The package manager is pnpm (ADR 0001) and the root `package.json` is micro-step 0.9.a.
- Don't create cloud resources. Phase 0 explicitly provisions nothing.
- Don't fill `docs/architecture/ecs-design.md` — it is written during the AWS sprint, from measurements.

## Deliberate omissions

`.gitkeep` files hold empty directories in Git.

## Before your first command

```sh
node scripts/check-toolchain.mjs
```

It checks Node, pnpm, Docker Engine, Compose and Git against Blueprint §4.7 and prints a table. Node and pnpm fail loudly on their own through `engines` and `packageManager`; Docker, Compose and Git are only floored, so this script is the only thing that catches a Compose v2 CLI before it produces a confusing error at Phase 2.

`.nvmrc` says **26**, matching the Docker base image and the CI matrix. `engines` also admits Node 24 so a contributor on the Maintenance LTS still gets a working build — but 26 is the target, and a mismatch is recorded in `BUILD_STATE.md` rather than worked around.
