---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-07-15
last-synced: 2026-07-15
completeness: 85
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
---

# @effected/pnpm-plugin-effect design

## Overview

`@effected/pnpm-plugin-effect` is the kit's [companion](../effect-standards.md#companion-packages-published-but-not-a-library) package — published and installable, but not a library and with no `*-effect` source repo behind it. It is a pnpm **config dependency** (installed with `pnpm add --config`, not as a normal dependency) that centralizes Effect-ecosystem versioning by publishing pnpm [catalogs](https://pnpm.io/catalogs). It is the single source of truth for what "the current Effect version" means across the monorepo — every `@effected/*` package references `catalog:effect` / `catalog:effectPeers` — and, once published, for any external workspace that installs it.

The two catalogs consumers pin against:

- **`effect`** — every `effect` / `@effect/*` package pinned to the current Effect v4 beta.
- **`effectPeers`** — the same package set resolved down to a **calculated shared floor**: the lowest common version safe to declare as a peer range, so libraries constrain their consumers as little as possible.

A parallel **`effect3`** catalog tracks Effect v3 for cross-version testing; see [The effect3 interop catalog](#the-effect3-interop-catalog).

## How it generates the catalogs

The catalog strategy is declared in [`savvy.build.ts`](../../../../packages/pnpm-plugin-effect/savvy.build.ts) via `rolldown-pnpm-config`'s `PnpmConfigPlugin`. Each package entry carries a `range` (the pinned version for the catalog), a `peer` (the input to the floor computation) and a `strategy`. Memberships, versions and strategies all live in `savvy.build.ts` — read it rather than a transcription that rots on every beta bump. Three facts are load-bearing:

- **The `effect` (v4) catalog pins exact, never a caret.** A caret on a prerelease floats across the beta line and desynchronizes the installed `effect` from the `.repos/effect-smol` submodule that is authoritative on what v4 exports.
- **The `effect` catalog uses the `lock` strategy.** Every consumer resolves to the same pinned version on install, so the whole graph holds one Effect v4 beta rather than each consumer re-deriving a range.
- **The `effect3` catalog uses the `interop` strategy**, which downlevels peers to the widest safe floor — see [The effect3 interop catalog](#the-effect3-interop-catalog).

`rolldown-pnpm-config` reads this config and emits the catalogs, computing `effectPeers` from the `peer` inputs. The build sets `bundleNodeModules: true` and uses `looseFiles` to ship the pnpmfile (`pnpmfile.mjs` / `pnpmfile.cjs` from `src/pnpmfile.ts`) that pnpm loads as the config dependency's hook. `src/index.ts` and `src/pnpmfile.ts` are one-line re-exports over `rolldown-pnpm-config` virtual modules; all real configuration is in `savvy.build.ts`.

## The effect3 interop catalog

Alongside the v4 `effect` catalog the plugin publishes an **`effect3`** catalog tracking the latest Effect v3 releases for most `effect` / `@effect/*` packages. Its `interop` strategy downlevels peers to the lowest safe floor. Its purpose is convenience: testing a package against **both** Effect v3 and v4 within one monorepo rather than standing up a second workspace to exercise the v3 line.

It is transitional. **The `effect3` catalog is removed at this plugin's `1.0.0`, once Effect `4.0.0` ships** and there is no v3 line left to interop with — the same graduation Effect `4.0.0` triggers across the kit ([releases.md](../releases.md#versioning)). Its membership, exclusions and versions live in [`savvy.build.ts`](../../../../packages/pnpm-plugin-effect/savvy.build.ts).

Upstream Effect manifests occasionally introduce peer issues on a catalog advance; the [catalog-bump procedure](../architecture.md#re-pinning-when-the-effect-catalog-bumps) covers re-pinning the submodule and reconciling any mismatch a bump surfaces.

Like every package it typechecks with `tsc --noEmit` against `typescript` at `catalog:silk` ([package-setup.md](../package-setup.md#the-typechecker-tsc-not-tsgo)); as a companion it ships no `effect`-importing code.

## Maintainer workflows

Three root scripts drive catalog maintenance. They regenerate the plugin's own definitions and mutate the lockfile and root `pnpm-workspace.yaml`, so they are **user-run commands; agents must not invoke them** — surface the right command and let the user run it.

- **`pnpm pnpm:up`** — pins each `effect` / `@effect/*` package to its latest v4 release, then recomputes the `effectPeers` floor. This is how the catalogs advance as new betas land.
- **`pnpm pnpm:export`** — exports the generated catalogs to the root `pnpm-workspace.yaml` and surfaces any drift between the plugin's definitions and what the workspace pins.
- **`pnpm pnpm:preview`** — previews the generated catalog output without writing.

Advancing the beta is `pnpm pnpm:up` then `pnpm pnpm:export`.

## Consumer usage

Installing the config dependency gives a workspace both catalogs. The two consumer patterns:

- **Applications** reference the pinned versions directly in `dependencies` (`"effect": "catalog:effect"`), so the app always runs the current Effect.
- **Libraries** pin the dev version and declare the calculated floor as the peer range: `catalog:effect` in `devDependencies`, `catalog:effectPeers` in `peerDependencies`. This keeps the library building against current Effect while advertising the widest compatible peer range.

The install steps and the two patterns are the package [README](../../../../packages/pnpm-plugin-effect/README.md); the maintainer workflows above are intentionally kept out of it.

## Relationship to the workspace peer discipline

These catalogs are the mechanism behind the [peer-dependency discipline](../effect-standards.md#peer-dependency-discipline) in the standards: `@effected/*` libraries keep `effect` as a `catalog:effect` peer and declare `catalog:effectPeers` as their advertised floor.

The v3/v4 peer-resolution bug that once required pnpm-resolver workarounds is fixed upstream, and `pnpm peers check` is clean. Neither `dedupePeerDependents` nor `dedupeDirectDeps` is set anywhere — pnpm's defaults apply; only `autoInstallPeers: true` is set in `pnpm-workspace.yaml`. The one known residual is recorded in [effect-standards.md](../effect-standards.md#open-defect-one-peers-check-issue).

## Classification: companion

This package is the kit's [companion](../effect-standards.md#companion-packages-published-but-not-a-library): published and installable, exposing no API. It carries **no tier**, because tier answers "what does depending on this cost you?" and nothing can depend on it — there is nothing to import and nothing to call. What it ships is configuration (two pnpm catalogs and a pnpmfile), not code. The three-tier taxonomy classifies libraries and this is not one; `companion` is a category, not a fourth tier.

Its value was largest under Effect v3, where computing peer floors by hand was genuinely hard; v4 makes that easier, so **installing it is optional for the consumer** — but it is a supported, shipped option, not an internal tool that happens to be publishable. That payoff lands with `@effected/app`: an application wiring up the kit adopts the same calculated versions in one step.

## Publishing

It is a real npm-targeted package (`publishConfig.targets.npm` is `true`) that **publishes with the kit at `0.1.0`, on the release gate like every other package** ([releases.md](../releases.md#versioning)). Being a companion rather than a library makes it structurally free to release on its own schedule, but the release is coordinated by design so consumers get one internally consistent graph on day one — the companion included, since its purpose is to hand consumers the same pinned `effect` versions the kit was built against.

Do not infer release intent from surface signals: every source manifest in this repo is `"private": true`, `npm view` 404s for every package, and the bundler's `publishConfig` transform (`access: public`, `directory: dist/dev/pkg`, `linkDirectory: true`) emits the publishable manifest at build time ([package-setup.md](../package-setup.md)). This package's `publishConfig.targets.npm` is byte-identical to the library packages'. The initial release is tracked by a changeset in `.changeset/`.
