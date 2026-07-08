---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-07-07
last-synced: 2026-07-07
completeness: 80
related:
  - effect-standards.md
  - package-inventory.md
  - migration-playbook.md
  - package-setup.md
  - plugin.md
---

# Monorepo architecture

## Overview

The effected monorepo (GitHub `spencerbeggs/effected`, npm org `@effected`) is the single home for developing the `@effected/*` family of Effect-ecosystem libraries. It replaces per-repo development of the `*-effect` libraries, which suffered cross-repo release loops and dependency-interaction bugs that only surfaced after publishing. Which repos migrate here and in what order is tracked in [package-inventory.md](package-inventory.md).

## Scope: libraries only

This repo contains libraries, not applications. Tools and apps built on these libraries — rolldown-pnpm-config, vitest-agent, rspress-plugin-api-extractor and the `@savvy-web/*` silk-action system — stay in their own repos and consume published `@effected` packages. If something has an entry point a user runs rather than an API a program imports, it does not belong here.

## Effect v4-first

All `@effected/*` packages target Effect v4 (currently beta, pinned via the `effect` catalog in `pnpm-workspace.yaml`), tracking beta releases until v4 stabilizes. See the [v4 beta announcement](https://effect.website/blog/releases/effect/40-beta/). Ports from the v3 `*-effect` repos are redesigns against v4 idioms, not lift-and-shifts — the migration process is defined in [migration-playbook.md](migration-playbook.md) and API conventions in [effect-standards.md](effect-standards.md).

## Release posture

No npm releases initially. Changesets stays wired but idle until the foundation matures and Effect v4 stabilizes. The original `*-effect` repos remain the live v3 line in the meantime, so nothing here is load-bearing for downstream consumers yet.

## Layout

- `packages/*` — one directory per `@effected` library; see [package-setup.md](package-setup.md) for how a package is scaffolded.
- `packages/pnpm-plugin-effect` — repo infrastructure (pnpm catalog/config plugin), not a library port.
- `plugin/` — the "effective" Claude Code plugin; see [plugin.md](plugin.md).
- `website/` — RSPress docs site with per-package api-extractor models under `website/lib/models/`.

Build tooling is `@savvy-web/silk` (rslib/tsdown bundler, turbo, changesets, biome); see the root `CLAUDE.md` for commands and pipeline details.
