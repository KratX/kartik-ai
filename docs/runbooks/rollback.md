# Rollback runbook

Placeholder — becomes operational in Phase 16.

## Principle

A rollback that has never been executed is not a rollback. Rehearse it once during Phase 16 and record the result in `TEST_EVIDENCE.md`.

## Procedure

1. Identify the last known-good image tag (recorded in `BUILD_STATE.md` and the deployment log).
2. Re-deploy that tag with the same Compose file.
3. Wait for `/health/ready` on every service.
4. Smoke test: sign in, send a mock chat message, download an artifact.
5. Record the rollback in `BUILD_STATE.md` with the reason and the timestamp.

## If the failure is in the database

Re-deploying images will not fix a bad migration. Stop, restore from the last verified backup, and record the incident. This is why the restore drill is part of the deployment gate.
