---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-07-13
last-synced: 2026-07-13
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
- **The kit is finished, and finishing is defined.** The scope is closed by the five applications named in [releases.md](releases.md), not by the number of `*-effect` repos remaining. One source repo (`json-schema-effect`) fell off the roadmap under that test, and the migration list in [package-inventory.md](package-inventory.md#migration-order) is complete; what remains before `0.1.0` is the [revised gate](roadmap.md#the-revised-010-gate). The test names a package's minimum, not its bound — `@effected/toml` shipped as a full-parity format package even though its gate consumer needs only parse/stringify ([releases.md](releases.md#effectedtoml-is-a-full-parity-format-package)).

## Scope: libraries only

This repo contains libraries, not applications. Tools and apps built on these libraries — rolldown-pnpm-config, vitest-agent, rspress-plugin-api-extractor and the `@savvy-web/*` silk-action system — stay in their own repos and consume published `@effected` packages. If something has an entry point a user runs rather than an API a program imports, it does not belong here.

The libraries-only rule and the app kit framing are not in tension: the applications stay outside, but they are what the kit is measured against. Two of the five named in [releases.md](releases.md) — `type-registry-effect` and `runtime-resolver` — are libraries wearing app clothing, and they migrate in.

## Effect v4-first

All `@effected/*` packages target Effect v4 (currently beta, pinned via the `effect` catalog in `pnpm-workspace.yaml`), tracking beta releases until v4 stabilizes. See the [v4 beta announcement](https://effect.website/blog/releases/effect/40-beta/). Ports from the v3 `*-effect` repos are redesigns against v4 idioms, not lift-and-shifts — the migration process is defined in [migration-playbook.md](migration-playbook.md) and API conventions in [effect-standards.md](effect-standards.md).

## Release posture

No npm releases until the whole kit ships together at `0.1.0`; `1.0.0` waits for Effect v4 GA. Changesets stays wired but idle in the meantime, and the original `*-effect` repos remain the live v3 line, so nothing here is load-bearing for downstream consumers yet. The gate — which packages must land, and which fall off the roadmap — is [releases.md](releases.md).

## Layout

- `packages/*` — one directory per `@effected` library; see [package-setup.md](package-setup.md) for how a package is scaffolded.
- `packages/pnpm-plugin-effect` — the kit's [companion](effect-standards.md#companion-packages-published-but-not-a-library) (pnpm catalog/config plugin): published with the kit and installable by consumers, but not a library and not a library port, so it carries no tier.
- `plugin/` — the "effective" Claude Code plugin; see [plugin.md](plugin.md).
- `.claude/skills/improve` — the project-level self-improvement skill that maintains `plugin/skills/`; see [plugin.md](plugin.md).
- `.repos/effect-smol` — vendored Effect v4 source, a sparse git submodule, read-only reference material; see [Vendored source](#vendored-source).
- `website/` — RSPress docs site with per-package api-extractor models under `website/lib/models/`.

Build tooling is `@savvy-web/silk` (rslib/tsdown bundler, turbo, changesets, biome); see the root `CLAUDE.md` for commands and pipeline details.

## Vendored source

`.repos/effect-smol` is a git submodule of [Effect-TS/effect-smol](https://github.com/Effect-TS/effect-smol), declared in `.gitmodules` and managed by the silk plugin's repos tooling through the `.repos/config.json` manifest (url, ref, purpose, sparse paths, orientation notes). It is pinned to the release tag matching the `effect` catalog pin in `pnpm-workspace.yaml` — **not** tracking `main`. Pinning is the whole point: a vendored tree at `main` drifts ahead of the beta we compile against, letting an agent assert, with source in hand, a surface that does not exist in the installed version. That is a worse failure than guessing, because the evidence looks conclusive.

The checkout is **sparse** — only the trees agents actually read are materialized: `packages/effect` (the v4 export authority), `packages/vitest` (the `@effect/vitest` reference implementation) and `migration`, `ai-docs`, `LLMS.md`, `MIGRATION.md` (the rename evidence for the plugin's evidence ladder). The sparse set is recorded in `.repos/config.json`.

**The vendored content is not always present.** Submodule content is not stored in the parent tree, so fresh clones, CI runners and new git worktrees start with an empty `.repos/` checkout — run `savvy repos sync` (or the `repos_manage` MCP tool with `action:"sync"`) once before relying on it. GitHub tarball downloads never contain submodule content at all.

### Re-pinning when the `effect` catalog bumps

Re-pinning is one operation:

~~~bash
savvy repos pin effect-smol --ref effect@<new-tag>   # or the repos_manage MCP tool, action:"pin"
~~~

The pin stages the gitlink and the `.repos/config.json` manifest and returns a ready-made conventional commit message. **Fold that staged change into the same commit as the catalog bump** — source and installed version move together by construction. The pin also flags `staleNoteIds` — manifest notes stamped against an older ref — for review.

Note that the [upstream blog post](https://effect.website/blog/the-one-weird-git-trick-that-makes-coding-agents-more-effect-ive/) recommending vendored Effect source vendors `Effect-TS/effect` — the **v3** repo. Following it verbatim would install the v3 source as agent-authoritative reference, which is precisely the confusion this repo has been fighting: the workspace root resolves `effect@3.21.4` and will describe the v3 surface with total confidence.

### Read-only, enforced

The vendored tree is read-only, and the silk plugin enforces it rather than trusting convention: its PreToolUse guards deny Write, Edit, Bash and MCP-git mutations under `.repos/**`. Check dirtiness with `savvy repos status` (or `repos_inspect` with `mode:"status"`).

The tree also stays outside every build and lint graph: the silk Biome preset centrally excludes `**/.repos` (the root `biome.jsonc` no longer carries a local override for it), markdownlint's config keeps `**/.repos` in its ignores, dependabot excludes `.repos/**`, and pnpm, turbo and vitest never matched the directory by glob in the first place. Its consumers are the `improve` skill and the plugin's `effect-v4-source-lookup` skill — the one file in `plugin/` that names the path (see [plugin.md](plugin.md)).

## Dependency resolution

The repo runs a v4 `effect` in its packages and a v3 `effect` in its toolchain (`@savvy-web/*`, rspress, api-extractor), sharing one `node_modules` tree. Under pnpm's `autoInstallPeers: true` an unresolved `effect` peer used to bind to the *workspace-preferred* version — v4 — and leak into v3-wanting importers. **That resolver bug is fixed upstream** ([pnpm/pnpm#12847](https://github.com/pnpm/pnpm/pull/12847), shipped in pnpm 11.11.0, with the remainder in **11.12.0**, which this repo now runs). The workarounds it forced are gone; what survives below is ordinary configuration, and it is documented so nobody re-derives a workaround for a solved problem.

### The catalogs pin exact betas — but `effectPeers` carries carets

`catalog:effect` pins **exact** beta versions (`4.0.0-beta.97`, no caret). A caret range on a prerelease floats freely across the beta line, which silently desynchronizes the installed `effect` from the `.repos/effect-smol` submodule that is supposed to be the authority on what v4 exports — the failure described in [Vendored source](#vendored-source), arriving through the lockfile instead of through the vendored tree.

`catalog:effectPeers` is a different thing and correctly carries carets (`^4.0.0-beta.97`). It is the **computed peer floor** — the range `@effected/*` libraries advertise to their consumers, not the version installed here. It widened from exact to caret pins on the beta.97 bump. Both catalogs are generated by [`packages/pnpm-plugin-effect`](packages/pnpm-plugin-effect.md); the exact/caret split lives in its `savvy.build.ts` as a `range` / `peer` pair per package.

### The typechecker: tsc, not tsgo

Every package typechecks with `tsc --noEmit` against `typescript` (`catalog:silk`). `@effect/tsgo` was removed from all packages in commit `d0599438` — it began as a workaround for the pnpm peer-resolution bug and survived on inertia after the upstream fix — and it lingers only as a `pnpm-workspace.yaml` catalog entry with no consumer. Do not reintroduce it; see [package-setup.md](package-setup.md#the-typechecker-tsc-not-tsgo) and the settled item in [effect-standards.md](effect-standards.md#verified-workspace-configuration).

Related history: `@savvy-web/bundler` used to live at the root only, resolved by Node's upward `node_modules` walk, because a per-package copy put a v3-wanting `@effect/platform-node` beside a v4 `effect` in every importer. Fixed upstream; the bundler is now a normal devDependency of every package that builds.

### The `overrides` entry — re-scope it on every catalog bump

`overrides` in `pnpm-workspace.yaml` pins `@effect/platform-node@4.0.0-beta.97>@effect/platform-node-shared` to `4.0.0-beta.97`.

Upstream, `@effect/platform-node` declares its own sibling as `"@effect/platform-node-shared": "^4.0.0-beta.97"` — a caret on a prerelease — so it floats to a later beta whose `effect` peer the exact-pinned core no longer satisfies. Catalogs bind only *direct* workspace deps; this float is one level down, inside a dependency's manifest, and `overrides` is the only lever that reaches it. Keep it **scoped to the v4 parent**; an unscoped `@effect/platform-node-shared` override would also replace the v3-era `0.60.0` the tooling chain resolves.

**The scope key names a specific version, so it must be re-scoped on every catalog bump.** This is the live failure mode, not a hypothetical: through the beta.97 upgrade the override still read `@effect/platform-node@4.0.0-beta.94>…` and therefore matched no parent in the tree and sat **inert** — present in the file, doing nothing, and looking exactly like a working pin. Bump the catalogs and the override key together.

### Peer-closure warnings

`pnpm peers check` is **clean — zero issues**. There is no expected-residual set and nothing to ignore: **any** warning is a genuine closure defect to fix upstream. (Historically a set of `@effect/platform` / `@effect/rpc` / `@effect/sql` / `@effect/cluster` warnings wanting `effect@^3.21.x` was expected and explicitly not to be chased. It is gone — do not reintroduce that allowance.) The peer-closure discipline itself is in [effect-standards.md](effect-standards.md).

Finally: always check the lockfile diff after an install. A plain `pnpm install` once stripped the turbo, biome and tsgo platform binaries from it.
