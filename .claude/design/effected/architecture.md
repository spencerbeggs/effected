---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-07-11
last-synced: 2026-07-11
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
- **The kit is finished, and finishing is defined.** The scope is closed by the five applications named in [releases.md](releases.md), not by the number of `*-effect` repos remaining. One source repo (`json-schema-effect`) falls off the roadmap under that test, and the remaining work is the closed migration list in [package-inventory.md](package-inventory.md#migration-order) rather than an open horizon. The test names a package's minimum, not its bound: `@effected/toml` was rescoped down to `parse`/`stringify`/Schema by it on 2026-07-09 and then re-specced back to a full-parity format package on 2026-07-10 — see [releases.md](releases.md#effectedtoml-is-a-full-parity-format-package).

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

The tree was added once, at the tag matching the catalog:

~~~bash
git subtree add --prefix=repos/effect-smol https://github.com/Effect-TS/effect-smol.git effect@4.0.0-beta.94 --squash
~~~

### Re-pinning when the `effect` catalog bumps

This repo **does not allow merge commits**, and `git subtree pull` is a merge — it creates one every time. So a re-pin is a pull followed by a squash:

~~~bash
git subtree pull --prefix=repos/effect-smol https://github.com/Effect-TS/effect-smol.git effect@<new-tag> --squash
git reset --soft HEAD~2   # drop the merge commit and the squashed-content commit
git commit                # one commit — see the trailer requirement below
~~~

**The new commit message must carry both subtree trailers forward**, verbatim from the commit being collapsed:

~~~text
git-subtree-dir: repos/effect-smol
git-subtree-split: <the upstream commit sha for the new tag>
~~~

This is load-bearing, not cosmetic. `git subtree pull` finds where the vendored tree came from by grepping ancestor commit messages for `git-subtree-dir`. Squash the trailers away and the *next* re-pin has no split point to work from. Verified 2026-07-09 after squashing the initial `subtree add`: with the trailers preserved, `git subtree pull` at the pinned tag reports `Subtree is already at commit …` and exits 0.

Commit with `--no-verify`. lint-staged would otherwise try to process the tree's ~2,000 vendored files.

Re-pinning runs when the `effect` catalog bumps, so source and installed version move together by construction. Note that the [upstream blog post](https://effect.website/blog/the-one-weird-git-trick-that-makes-coding-agents-more-effect-ive/) recommending this technique vendors `Effect-TS/effect` — the **v3** repo. Following it verbatim would install the v3 source as agent-authoritative reference, which is precisely the confusion this repo has been fighting: the workspace root resolves `effect@3.21.4` and will describe the v3 surface with total confidence.

The vendored tree is read-only and must stay outside every build and lint graph — turbo, biome, vitest and markdownlint each need it excluded. It exists for one consumer, the `improve` skill; the plugin's own skills never reference the path (see [plugin.md](plugin.md)).

Build tooling is `@savvy-web/silk` (rslib/tsdown bundler, turbo, changesets, biome); see the root `CLAUDE.md` for commands and pipeline details.

## Dependency resolution: holding the v4/v3 line

The repo runs a v4 `effect` in its packages and a v3 `effect` in its toolchain (`@savvy-web/*`, rspress, api-extractor). Those two lines share one `node_modules` tree, and pnpm's `autoInstallPeers: true` is what makes them leak into each other: an unresolved `effect` peer anywhere in the graph binds to the *workspace-preferred* version, which is v4. Every mechanism below exists to stop a v3-wanting importer from being handed a v4 core. The root `CLAUDE.md` carries the rules; this section carries the reasons, so an agent tempted to delete a pin as redundant can find out first what it holds.

### The catalogs pin exact betas

The Effect catalogs pin **exact** beta versions (`4.0.0-beta.94`, no caret). A caret range on a prerelease floats freely across the beta line, which silently desynchronizes the installed `effect` from the `repos/effect-smol` subtree that is supposed to be the authority on what v4 exports — the failure described in [Vendored source](#vendored-source), arriving through the lockfile instead of through the subtree.

### `@effect/tsgo` as the declared typechecker

Each package declares `@effect/tsgo` (`catalog:effect`) as its typechecker devDependency rather than `@typescript/native-preview` (`catalog:silk`). What matters is the **declaration**, not the binary: it makes the typechecker's own `effect` peer ride the v4 catalog instead of the silk (v3-tooling) catalog. Under `autoInstallPeers: true` that stops the auto-installed `effect` peers in the tooling chain from resolving the workspace-preferred v4 into v3-wanting importers.

Upstream patch pnpm/pnpm#12847 landed in **pnpm 11.11.0**, so this declaration may no longer be needed. It stays until someone verifies that removing it keeps `pnpm peers check` clean.

Related history: `@savvy-web/bundler` used to live at the root only, resolved by Node's upward `node_modules` walk, because a per-package copy put a v3-wanting `@effect/platform-node` beside a v4 `effect` in every importer. That was fixed upstream in pnpm 11.11.0, and the bundler is now a normal devDependency of every package that builds.

### Load-bearing pin 1: the `overrides` entry

`overrides` in `pnpm-workspace.yaml` pins `@effect/platform-node@4.0.0-beta.94>@effect/platform-node-shared` to `4.0.0-beta.94`.

Upstream, `@effect/platform-node@4.0.0-beta.94` declares its own sibling as `"@effect/platform-node-shared": "^4.0.0-beta.94"` — a caret on a prerelease — so it floats to a later beta whose `effect` peer the exact-pinned core no longer satisfies. Catalogs bind only *direct* workspace deps; this float is one level down, inside a dependency's manifest, and `overrides` is the only lever that reaches it.

The override is **scoped to the v4 parent** on purpose. An unscoped `@effect/platform-node-shared` override also replaces the v3-era `0.60.0` that the v3 tooling chain needs, poisoning it in the opposite direction.

### Load-bearing pin 2: `website` declares `effect: catalog:silk`

The `website` package declares `effect: catalog:silk` (v3). It looks redundant — `rspress-plugin-api-extractor` resolves its own `effect` at v3 correctly — but its transitive `type-registry-effect` declares `effect` and `@effect/platform` as **peers**; under `autoInstallPeers: true` those bound to the workspace's v4 preference, yielding a v3 `@effect/platform` built against a v4 core whose `Context` no longer exports `GenericTag`. `rspress.config.ts` died on it and the docs site was broken on `main` with nothing in CI to catch it.

The generalizable rule: a transitive dependency that *peers* on `effect` is the poisoning surface; one that merely depends on it is fine.

### Peer-closure warnings

Treat new `pnpm peers check` warnings as upstream closure defects to fix, not warnings to silence. One residual warning is **expected**: `@effect/platform`, `@effect/rpc`, `@effect/sql` and `@effect/cluster` want `effect@^3.21.x`, reaching the tree through the build/test tooling chain (`@savvy-web/bundler` → `@savvy-web/tsdown-plugins` → `@effect/platform-node`; `@savvy-web/silk` and `@vitest-agent/plugin` → `@effect/cli`). It is under investigation — do not chase it. A warning outside that set is a genuine defect. The peer-closure discipline itself is in [effect-standards.md](effect-standards.md).

Finally: always check the lockfile diff after an install. A plain `pnpm install` once stripped the turbo, biome and tsgo platform binaries from it.
