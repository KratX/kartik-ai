# Kartik.ai Phase Checklist

Tick an item only when evidence exists in `TEST_EVIDENCE.md` or `BUILD_STATE.md`.

## Phase 0 — Project setup, scope and safety baseline
- [ ] 0.1 Environment inspected and recorded
- [ ] 0.2 `BUILD_STATE.md` and `0000-project-baseline.md` created
- [ ] 0.3 Repository created, default branch set
- [ ] 0.4 README with goal, stack, planned agents
- [ ] 0.5 `.gitignore` covering `node_modules`, `.env*`, builds, logs, local data
- [ ] 0.6 `.editorconfig` and formatting rules
- [ ] 0.7 Node LTS chosen, pinned in `.nvmrc`, used in CI
- [ ] 0.8 `docs/architecture/overview.md` matches Section 2
- [ ] 0.9 Decision records 0001–0003 created
- [ ] 0.10 `.env.example` files with placeholders only
- [ ] 0.11 Secret scanning and branch protection enabled
- [ ] 0.12 Cloud-cost checklist created; no cloud resources provisioned

**Phase 0 exit gate:** a new developer can understand the planned application without the tutorial video, and no real credential exists in Git history.

## Phases 1–17
Add each phase's exit gate here when the phase starts. Do not pre-tick.
