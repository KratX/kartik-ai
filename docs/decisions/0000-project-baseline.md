# ADR 0000 — Project baseline

- **Status:** Accepted — every row below is verified against the owner's machine
- **Date:** 9 November 2026 (toolchain recorded)
- **Phase:** 0.1

## Context

Before any implementation, the environment, toolchain and unresolved choices must be recorded so that a later session (human or AI) can resume without guessing. This record deliberately separates **verified facts** from **open decisions**; nothing below is assumed.

## Verified facts

Reported by the owner on **9 November 2026** and recorded verbatim.

| Item | Value | How verified | Date |
|---|---|---|---|
| Operating system | **Windows NT 10.0.19045.0** — Windows 10 Pro, 22H2 | `[Environment]::OSVersion.VersionString` | 9 Nov 2026 |
| Shell | **PowerShell 5.1.19041.6456** | `$PSVersionTable.PSVersion` | 9 Nov 2026 |
| Node.js installed | **v26.13.0** — the target version; `engines` also admits 24 for contributors | `node -v` | 9 Nov 2026 |
| Package manager | **pnpm 12.18.0** — matches the `packageManager` pin; no `package-lock.json` or `yarn.lock` reported | `pnpm -v` | 9 Nov 2026 |
| Docker engine | **29.9.3** — daemon reachable from the Windows CLI | `docker info --format '{{.ServerVersion}}'` | 9 Nov 2026 |
| Docker Compose | **v5.7.0** | `docker compose version` | 9 Nov 2026 |
| Git available | **2.39.0.windows.2** | `git --version` | 9 Nov 2026 |
| Uncommitted work to preserve | None — the tree is not a git repository yet | not run; deliberate, see Phase 0.8 | 9 Nov 2026 |

### Reading of the facts

- **Node 26.13.0 is the target version, running locally.** No divergence to manage: `.nvmrc`, the Docker base image and CI all say 26. `engines` still admits 24 so a contributor on the older Maintenance LTS gets a working build.
- **pnpm 12.18.0 on the host is exactly the pin.** No skew between the owner's shell and `packageManager`. Note that the pin does not enforce itself on a developer machine: `manage-package-manager-versions` is off by default, so a future pnpm upgrade on the host silently wins until this table is updated.
- **Windows 10 22H2 build 19045 is the last build Docker Desktop supports on Windows 10.** Desktop will install and receive patches, but a Windows 11 upgrade removes a class of future problems (WSL 2.1.5+ requirements tighten over time). Not a blocker today.
- **Compose v5.7.0 is a v5-era CLI.** Three v5 behaviours are now binding constraints on the compose file written in 0.9: the internal BuildKit builder is gone (builds delegate to Docker Bake), `secrets.*.driver` and `configs.*.driver` are rejected, and `docker compose ps --format=json` changed shape. Project names must also be lowercase, so `.env.compose.example` already complies with `COMPOSE_PROJECT_NAME=kartik`.
- **The daemon answers, so the Docker question is closed.** Engine **29.9.3** is a November-2026 patch of the 29.x line (29.9.0 shipped 8 October 2026), and a Windows-native CLI can only reach a daemon that is running. Docker Desktop is confirmed present and started — this is Path A, already in place. No WSL install, no Engine-in-WSL, no Codespaces fallback is needed.
- **Engine 29 is a major version with three breaking changes**, all already behind this host: the minimum client API floor moved to **1.44** (older hardcoded clients are refused — Compose v5.7.0 is far past it), the **containerd image store** became the default (multi-platform manifests now work natively, which is what the ARM64 Profile P images need), and nftables became an opt-in firewall backend. None of these are project decisions; they are facts to not fight.
- **RAM and virtualisation are answered empirically, not by spec.** Docker Desktop cannot report a server version if the WSL 2 VM failed to allocate memory or virtualization was disabled in firmware. Engine 29.9.3 answering *is* the proof, and it retires the two unknowns carried since the first host inspection.
- **Windows 10 22H2 build 19045 remains the ceiling for Docker Desktop on Windows 10.** Patches continue; feature support does not. No action now, but the Windows 11 upgrade is the cheapest future-proofing available.

## Open decisions

| Decision | Options | Blocks | State |
|---|---|---|---|
| Language | TypeScript everywhere · JavaScript everywhere · JS backend + TS frontend | Phase 1 | **Settled:** TypeScript everywhere |
| Node version | 24 (maintenance) · 26 (active LTS) | Phase 1 | **Settled:** 26 target, `engines` admits 24 |
| Package manager | npm · pnpm 10 · pnpm 12 | Phase 1 | **Settled:** pnpm 12.18.0 (ADR 0001) |
| Frontend state | Redux Toolkit · Zustand · React Query only | Phase 1 | **Settled:** TanStack Query + Zustand; Redux rejected |
| Shared-code strategy | pnpm workspaces · tsup bundling · tsx runtime | Phase 1 | **Settled:** pnpm workspaces + `tsc -b` project references (ADR 0001) |
| Demo host | Profile P (Oracle VM) · Profile B (managed free) | Phase 16 | **Settled:** Profile P |
| Docker on the host | Desktop on Windows · Engine inside WSL · GitHub Codespaces | Phase 2 (first `compose up`) | **Settled:** Docker Desktop on Windows, engine 29.9.3 live |

## Consequences

- No application code, dependency or infrastructure resource is created until the table in **Verified facts** is filled in and reviewed. That condition is met as of 9 November 2026.
- The build runs against Docker **v5 Compose semantics**, not the v2 files most tutorials still show. Any compose snippet pasted from elsewhere must be re-checked before it is trusted.
- Every later decision that is expensive to reverse gets its own numbered ADR.

## Next safe action

Proceed to micro-step 0.9.b — the seven workspace manifests — against pnpm 12.18.0 and Node 26.13.0 on the host. The compose stack is authored in 0.9 and first brought up at the Phase 2 gate.
