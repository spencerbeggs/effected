---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-07-09
last-synced: 2026-07-09
completeness: 85
related:
  - effect-standards.md
  - package-inventory.md
  - migration-playbook.md
  - package-setup.md
  - releases.md
  - plugin.md
---

# Monorepo architecture

## Overview

The effected monorepo (GitHub `spencerbeggs/effected`, npm org `@effected`) is the single home for developing the `@effected/*` family of Effect-ecosystem libraries. It replaces per-repo development of the `*-effect` libraries, which suffered cross-repo release loops and dependency-interaction bugs that only surfaced after publishing. Which repos migrate here and in what order is tracked in [package-inventory.md](package-inventory.md).

## Identity: an Effect v4 app kit

This is not a port of a collection of `*-effect` libraries that happen to share a repo. It is an **Effect v4 app kit** — the substrate the source libraries were always being written for. Each of them existed because some application needed configuration loading, or workspace resolution, or a durable cache, and none of them was ever the point on its own.

Two consequences follow, and they are why the reframe is recorded rather than assumed:

- **The unit of design is the kit, not the package.** Packages get carved along the seams the applications actually press on, not along the boundaries the source repos happened to inherit. `xdg-effect` shipped app-directory resolution and a SQLite store in one package; those are two things, and the kit splits them. Conversely, a split is not automatically right: `@pnpm/catalogs.*` stays inside `@effected/workspaces` because nothing yet asks for it separately.
- **The kit is finished, and finishing is defined.** The scope is closed by the five applications named in [releases.md](releases.md), not by the number of `*-effect` repos remaining. One source repo (`json-schema-effect`) falls off the roadmap under that test, `@effected/toml` is rescoped by it from a full-parity format package down to `parse`/`stringify`/Schema, and the remaining work is a list of ten packages rather than an open horizon.

## Scope: libraries only

This repo contains libraries, not applications. Tools and apps built on these libraries — rolldown-pnpm-config, vitest-agent, rspress-plugin-api-extractor and the `@savvy-web/*` silk-action system — stay in their own repos and consume published `@effected` packages. If something has an entry point a user runs rather than an API a program imports, it does not belong here.

The libraries-only rule and the app kit framing are not in tension: the applications stay outside, but they are what the kit is measured against. Two of the five named in [releases.md](releases.md) — `type-registry-effect` and `runtime-resolver` — are libraries wearing app clothing, and they migrate in.

## Effect v4-first

All `@effected/*` packages target Effect v4 (currently beta, pinned via the `effect` catalog in `pnpm-workspace.yaml`), tracking beta releases until v4 stabilizes. See the [v4 beta announcement](https://effect.website/blog/releases/effect/40-beta/). Ports from the v3 `*-effect` repos are redesigns against v4 idioms, not lift-and-shifts — the migration process is defined in [migration-playbook.md](migration-playbook.md) and API conventions in [effect-standards.md](effect-standards.md).

## Release posture

No npm releases until the whole kit ships together at `0.1.0`; `1.0.0` waits for Effect v4 GA. Changesets stays wired but idle in the meantime, and the original `*-effect` repos remain the live v3 line, so nothing here is load-bearing for downstream consumers yet. The gate — which packages must land, and which fall off the roadmap — is [releases.md](releases.md).

## Layout

- `packages/*` — one directory per `@effected` library; see [package-setup.md](package-setup.md) for how a package is scaffolded.
- `packages/pnpm-plugin-effect` — repo infrastructure (pnpm catalog/config plugin), not a library port.
- `plugin/` — the "effective" Claude Code plugin; see [plugin.md](plugin.md).
- `.claude/skills/improve` — the project-level self-improvement skill that maintains `plugin/skills/`; see [plugin.md](plugin.md).
- `repos/effect-smol` — vendored Effect v4 source, read-only reference material; see [Vendored source](#vendored-source).
- `website/` — RSPress docs site with per-package api-extractor models under `website/lib/models/`.

## Vendored source

`repos/effect-smol` is a `git subtree` of [Effect-TS/effect-smol](https://github.com/Effect-TS/effect-smol), pinned to the release tag matching the `effect` catalog pin in `pnpm-workspace.yaml` — **not** tracking `main`. Pinning is the whole point: a subtree at `main` drifts ahead of the beta we compile against, letting an agent assert, with source in hand, a surface that does not exist in the installed version. That is a worse failure than guessing, because the evidence looks conclusive.

~~~bash
git subtree add  --prefix=repos/effect-smol https://github.com/Effect-TS/effect-smol.git effect@4.0.0-beta.94 --squash
git subtree pull --prefix=repos/effect-smol https://github.com/Effect-TS/effect-smol.git effect@<new-tag>      --squash
~~~

The pull runs when the `effect` catalog bumps, so the two move together by construction. Note that the [upstream blog post](https://effect.website/blog/the-one-weird-git-trick-that-makes-coding-agents-more-effect-ive/) recommending this technique vendors `Effect-TS/effect` — the **v3** repo. Following it verbatim would install the v3 source as agent-authoritative reference, which is precisely the confusion this repo has been fighting: the workspace root resolves `effect@3.21.4` and will describe the v3 surface with total confidence.

The vendored tree is read-only and must stay outside every build and lint graph — turbo, biome, vitest and markdownlint each need it excluded. It exists for one consumer, the `improve` skill; the plugin's own skills never reference the path (see [plugin.md](plugin.md)).

Build tooling is `@savvy-web/silk` (rslib/tsdown bundler, turbo, changesets, biome); see the root `CLAUDE.md` for commands and pipeline details.
