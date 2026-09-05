---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 92
related:
  - effect-standards.md
  - catalog-sync.md
  - package-inventory.md
  - migration-playbook.md
  - package-setup.md
  - releases.md
  - plugin.md
  - scratchpad.md
---

# Monorepo architecture

## Overview

The effected monorepo (GitHub `spencerbeggs/effected`, npm org `@effected`) is the single home for developing the `@effected/*` family of Effect-ecosystem libraries. It replaces per-repo development of the predecessor `*-effect` libraries, which suffered cross-repo release loops and dependency-interaction bugs that only surfaced after publishing. The current package set and where each package came from are in [package-inventory.md](package-inventory.md).

## Identity: an Effect v4 app kit

This is not a collection of libraries that happen to share a repo. It is an **Effect v4 app kit** — the substrate the predecessor libraries were always being written for. Each of them existed because some application needed configuration loading, or workspace resolution, or a durable cache, and none of them was ever the point on its own.

Two consequences follow:

- **The unit of design is the kit, not the package.** Packages get carved along the seams the applications actually press on. `xdg-effect` shipped app-directory resolution and a SQLite store in one package; those are two things, and the kit splits them into `xdg` and `store`. Conversely, a split is not automatically right: `@pnpm/catalogs.*` stays inside `@effected/workspaces` because nothing yet asks for it separately.
- **Scope is closed by consumers, and finishing is therefore definable.** The kit is bounded by the five applications named in [releases.md](releases.md), not by how much surface an ecosystem could have. A capability with no named consumer does not get built — `@effected/json-schema` fell off under that test. The test names a package's minimum, not its bound: `@effected/toml` ships as a full-parity format package even though its consumer needs only parse/stringify ([releases.md](releases.md#effectedtoml-is-a-full-parity-format-package)).

## Scope: libraries only

This repo contains libraries, not applications. Tools and apps built on these libraries — rolldown-pnpm-config, vitest-agent, rspress-plugin-api-extractor and the `@savvy-web/*` silk-action system — stay in their own repos and consume published `@effected` packages. If something has an entry point a user runs rather than an API a program imports, it does not belong here.

The libraries-only rule and the app kit framing are not in tension: the applications stay outside, but they are what the kit is measured against. Two of the five named in [releases.md](releases.md) are libraries wearing app clothing, and each resolved the tension differently. `runtime-resolver`'s library half is in the kit as `@effected/runtimes` while its CLI re-ships from the external `runtime-resolver` repo; `type-registry-effect` stays external in full, because it carries the `typescript` peers the kit keeps out (see [releases.md](releases.md#the-five-applications)).

## Effect v4-first

All `@effected/*` packages target Effect v4 (currently prerelease, pinned via the `effect` catalog in `pnpm-workspace.yaml`), tracking v4 prereleases until v4 stabilizes — the release line renamed itself from `-beta` to `-rc` at `4.0.0-rc.108`, so both spellings name the same line. See the [v4 beta announcement](https://effect.website/blog/releases/effect/40-beta/). Packages are designed against v4 idioms rather than carried over from v3 shapes — the per-package cycle is in [migration-playbook.md](migration-playbook.md) and the API conventions in [effect-standards.md](effect-standards.md).

## Release posture

Everything published is `0.x` and unstable; `1.0.0` waits for Effect v4 GA. Releases are changeset-driven: CI builds the appropriate changesets and publishes the packages they name, whether that is the whole kit on a catalog advance or a single package on a patch. The release mechanics — how a package joins the stream, and which consumers scope the kit — are in [releases.md](releases.md).

## Layout

- `packages/*` — one directory per `@effected` library; see [package-setup.md](package-setup.md) for how a package is scaffolded.
- `packages/pnpm-plugin-effect` — the kit's [companion](effect-standards.md#companion-packages-published-but-not-a-library) (pnpm catalog/config plugin): published with the kit and installable by consumers, but not a library, so it carries no tier.
- `plugins/` — the repo's two agent plugins, each a workspace member with a private tracking package that versions it but never publishes to npm; see [plugin.md](plugin.md).
  - `plugins/claude-code/` — the "effected" Claude Code plugin, and the source of truth for all skill and agent content.
  - `plugins/copilot/` — an experimental GitHub Copilot plugin, ported downstream from the Claude Code tree and trailing it.
- `.claude/skills/improve` — the project-level self-improvement skill that maintains `plugins/claude-code/skills/`; see [plugin.md](plugin.md).
- `.repos/` — read-only vendored sources as sparse git submodules, `.repos/effect` chief among them; see [Vendored source](#vendored-source).
- `website/` — RSPress docs site with per-package api-extractor models under `website/lib/models/`.
- `scratchpad/` — a private agent-probe workspace member, never published and invisible to CI; see [scratchpad.md](scratchpad.md).

Build tooling comes from two `@savvy-web` packages: `bundler` (each package's `savvy.build.ts`, the dual dev/prod outputs and the `publishConfig` manifest transform) and `silk` (the Biome, commitlint, lint-staged, markdownlint and tsconfig presets), orchestrated by turbo. The root `CLAUDE.md` carries the pipeline's rules and `CLAUDE.build-and-test.md` its mechanics.

## Vendored source

`.repos/` holds read-only vendored sources as sparse git submodules, declared in `.gitmodules` and described by the `.repos/config.json` manifest (url, ref, purpose, sparse paths, orientation notes). `.repos/effect` is the load-bearing one and the rest are port bases and oracles for `@effected/markdown` — read the manifest for the current set rather than assuming it is only Effect.

`.repos/effect` is a git submodule of [Effect-TS/effect](https://github.com/Effect-TS/effect), managed by the silk plugin's repos tooling. It is pinned to the release tag matching the `effect` catalog pin in `pnpm-workspace.yaml` — **not** tracking `main`. Pinning is the whole point: a vendored tree at `main` drifts ahead of the prerelease we compile against, letting an agent assert, with source in hand, a surface that does not exist in the installed version. That is a worse failure than guessing, because the evidence looks conclusive.

The checkout is **sparse** — only the trees agents actually read are materialized: `packages/effect` (the v4 export authority), `packages/vitest` (the `@effect/vitest` reference implementation) and `migration`, `ai-docs`, `LLMS.md`, `MIGRATION.md` (the rename evidence for the plugin's evidence ladder). The sparse set is recorded in `.repos/config.json`.

**The vendored content is not always present.** Submodule content is not stored in the parent tree, so fresh clones, CI runners and new git worktrees start with an empty `.repos/` checkout — run `savvy repos sync` (or the `repos_manage` MCP tool with `action:"sync"`) once before relying on it. GitHub tarball downloads never contain submodule content at all.

### Re-pinning when the `effect` catalog bumps

Re-pinning is one operation:

```bash
savvy repos pin effect effect@<new-tag>   # or the repos_manage MCP tool, action:"pin"
```

The pin stages the gitlink and the `.repos/config.json` manifest and returns a ready-made conventional commit message. **Fold that staged change into the same commit as the catalog bump** — source and installed version move together by construction. The pin also flags `staleNoteIds` — manifest notes stamped against an older ref — for review.

### Read-only, enforced

The vendored tree is read-only, and the silk plugin enforces it rather than trusting convention: its PreToolUse guards deny Write, Edit, Bash and MCP-git mutations under `.repos/**`. Check dirtiness with `savvy repos status` (or `repos_inspect` with `mode:"status"`).

The tree also stays outside every build and lint graph: the silk Biome preset centrally excludes `**/.repos`, markdownlint's config keeps `**/.repos` in its ignores, dependabot excludes `.repos/**` and pnpm, turbo and vitest never matched the directory by glob in the first place. Its readers are the `improve` skill and the plugin's `effect-v4-source-lookup` skill (see [plugin.md](plugin.md)).

## Dependency resolution

The whole tree resolves to **one** `effect` copy — this workspace and the build toolchain (`@savvy-web/*`, rolldown-pnpm-config, vitest-agent) alike, on the prerelease the catalogs pin. That is the invariant to protect, and it is not merely tidiness: when the toolchain last lagged the pin, its copy and the workspace's met inside a single Schema decode pipeline and crashed every package's build with a type error from deep inside a parser. The remedy for a lagging toolchain is a temporary, spec-scoped `overrides` entry rewriting the tool's wanted spec to the pinned one, deleted the moment that tool republishes. **Expect to write one on every pin advance**: the toolchain cannot republish against a pin the kit has not shipped, so each advance opens a window where the second copy's entry point is outside this repo. **None stands today** — the rc.109→rc.112 bridge was retired once the toolchain republished, on a lockfile diff that removed only its three lines. The procedure and its removal condition are in [CLAUDE.dependencies.md](../../../CLAUDE.dependencies.md). The v3/v4 coexistence era is over — no Effect v3 remains anywhere in the lockfile — and the resolver bug it exposed (an unresolved `effect` peer binding to the workspace-preferred version and leaking into importers wanting another) is fixed upstream in pnpm ≥ 11.12.0, which this repo runs.

### The catalogs pin exact versions

The Effect catalogs — `effect` and `effect:peers` in `pnpm-workspace.yaml` — pin **exact** prerelease versions with no caret, generated by [`packages/pnpm-plugin-effect`](packages/pnpm-plugin-effect.md) under a lock strategy so the whole workspace resolves to one pinned version on install. Exact pinning is load-bearing: a caret range on a prerelease floats freely across the release line and silently desynchronizes the installed `effect` from the `.repos/effect` submodule that is the authority on what v4 exports — the failure described in [Vendored source](#vendored-source), arriving through the lockfile. The peers catalog is the range `@effected/*` libraries advertise to their consumers; it is locked exact to match, so a consumer pins the same version the kit was built against ([releases.md](releases.md#versioning)).

No Effect v3 catalog exists: the `effect3` / `effect3:peers` interop pair and the camelCase `effectPeers` / `effect3Peers` aliases are retired ([pnpm-plugin-effect.md](packages/pnpm-plugin-effect.md#the-retired-effect3-interop-catalogs)), and a catalog spelled that way is a stale reference to repair, not a surface to restore.

The plugin also publishes an `effected` / `effected:peers` pair carrying the kit's own packages. Those are **consumer-facing only** — they are not exported into `pnpm-workspace.yaml`, because internal edges stay `workspace:*`, and unlike the Effect catalogs they carry caret ranges under a `lock-minor` strategy rather than exact pins. A workflow triggered by pull requests to `main` and to `changeset-release/main` keeps them current automatically, which is also what keeps a release from publishing out of step with them ([catalog-sync.md](catalog-sync.md#the-publish-ordering-the-catalog-imposes)).

The build-tooling versions — `typescript`, `@types/node` and the bundler's own stack — come from `catalog:build`, which is **not** declared in `pnpm-workspace.yaml`: the `@savvy-web/pnpm-plugin-silk` config dependency injects it. Read the installed plugin under `node_modules/.pnpm-config/` when a `catalog:build` version needs checking, not the workspace file.

### The typechecker: tsc, not tsgo

Every package typechecks with `tsc --noEmit` against `typescript` (`catalog:build`). `@effect/tsgo` is not a package dependency — it lingers only as a `pnpm-workspace.yaml` catalog entry with no consumer. Do not reintroduce it; see [package-setup.md](package-setup.md#the-typechecker-tsc-not-tsgo) and [effect-standards.md](effect-standards.md#verified-workspace-configuration).

### Peer-closure warnings

`pnpm peers check` carries a known-issue slot whose occupant rotates as toolchains and catalogs move. The `CLAUDE.dependencies.md` context file is the live registry of the current occupant; this document deliberately does not duplicate it, because a list of resolved residuals reads exactly like a list of live ones. What is durable: the occupant is always in the *toolchain* graph rather than this workspace, it always clears when the offending tool republishes against the current prerelease, and there is no second expected residual — **any** other warning is a genuine closure defect to fix upstream. The structural remedy that retired the whole `@effect` satellite-drift class, a generated `peerDependencyRules.allowedVersions` table, is in [pnpm-plugin-effect.md](packages/pnpm-plugin-effect.md); the discipline it enforces is in [effect-standards.md](effect-standards.md#peer-dependency-discipline).

Always check the lockfile diff after an install — a plain `pnpm install` once stripped the turbo, biome and tsgo platform binaries from it.
