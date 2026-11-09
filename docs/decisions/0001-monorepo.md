# ADR 0001 — Monorepo with independently installable services

- **Status:** Proposed
- **Date:** 9 November 2026

## Context

The product has five backend applications (Gateway, Auth, Chat, Agent, Billing) plus a frontend. They share a small set of technical utilities but no business logic (Blueprint Section 4.3). They must be independently buildable into images and independently deployable.

## Options

1. **Polyrepo** — one repository per service. Clean isolation, but five sets of CI, five PR flows, and cross-service contract changes become coordination work.
2. **Single package monorepo** — one `package.json` for everything. Simplest, but it erases the service boundary the project exists to demonstrate and makes per-service Docker builds awkward.
3. **Monorepo with per-app manifests and one workspace root** (selected) — one Git repository; a root `package.json` plus `pnpm-workspace.yaml`; each app carries its own `package.json`; a single `pnpm-lock.yaml` at the root; shared code imported by package name as `@kartik/shared` (workspace protocol).

## Decision

Option 3, with **pnpm as the package manager**, pinned at **12.18.0** (amended 9 November 2026, Blueprint v3.2 §4.6). One repository, six installable applications, one lockfile, no shared business logic.

The package manager was left open when this ADR was written; the owner chose pnpm over npm. The trade was made knowingly: a shared content-addressable store and strict resolution, in exchange for the three costs listed under Consequences.

## Consequences

- **Positive:** one clone, one CI pipeline, atomic contract changes, and the service boundaries stay visible on disk.
- **Positive:** each service remains independently testable and deployable, which is the architectural point.
- **Positive:** a single `pnpm-lock.yaml` means one resolution of the dependency graph, not six.
- **Negative:** pnpm must be installed explicitly — Node 26 ships no Corepack — in the developer shell, in CI and in every Docker image.
- **Negative:** pnpm's symlinked `node_modules` breaks naive multi-stage `COPY --from=builder node_modules`; images use `pnpm deploy`, with a documented fallback.
- **Negative:** pnpm 11+ does not run dependency build scripts unless listed in `allowBuilds`; an unlisted native dependency now fails the *install* (`ERR_PNPM_IGNORED_BUILDS`) rather than failing later at runtime.
- **Negative:** pnpm 12's lockfile is a two-document YAML stream; `--frozen-lockfile` requires the `packageManager` pin inside it, and third-party readers (Dependabot's static parser) misread it. `pnpm audit` in CI is the dependency gate.
- **Negative:** `minimumReleaseAge` defaults to 24 hours, so a version published today is not installed today.
- **Negative:** the shared folder becomes a coupling risk. It is limited to technical utilities and contracts, and reviewed for scope creep.
- **Resolved:** `shared/` is a real workspace package with its own `tsconfig.json`, consumed by name (`"@kartik/shared": "workspace:*"`) and built with `tsc -b` project references. No bundler is in the loop for the backend; no relative cross-package imports.
