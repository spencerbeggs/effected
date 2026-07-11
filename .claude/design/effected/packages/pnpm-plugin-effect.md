---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-07-11
last-synced: 2026-07-11
completeness: 85
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
---

# @effected/pnpm-plugin-effect design

## Overview

`@effected/pnpm-plugin-effect` is **repo infrastructure that is also publishable**, not a library migration (it has no `*-effect` source repo; see [package-inventory.md](../package-inventory.md)). It is a pnpm **config dependency** — installed with `pnpm add --config`, not as a normal dependency — that centralizes Effect-ecosystem versioning by publishing two pnpm [catalogs](https://pnpm.io/catalogs):

- **`effect`** — every `effect` / `@effect/*` package pinned to the latest Effect v4 (beta) release.
- **`effectPeers`** — the same package set resolved down to a **calculated shared floor**: the lowest common version safe to declare as a peer range, so libraries constrain their consumers as little as possible.

It is the single source of truth for what "the current Effect version" means across the monorepo (every `@effected/*` package references `catalog:effect` / `catalog:effectPeers`) and, once published, for any external workspace that installs it. All `@effected/*` packages follow this same versioning.

## How it generates the catalogs

The catalog strategy is declared in [`savvy.build.ts`](../../../../packages/pnpm-plugin-effect/savvy.build.ts) via `rolldown-pnpm-config`'s `PnpmConfigPlugin`. Each package entry carries three fields:

- `range` — the pinned version for the `effect` catalog (e.g. `^4.0.0-beta.93`).
- `peer` — the input to the `effectPeers` floor computation.
- `strategy: "interop"` — how the peer floor is derived (the shared-floor interop strategy across the package's own peer declarations).

`rolldown-pnpm-config` reads this config and emits both catalogs. The build also uses `bundleNodeModules: true` and `looseFiles` to ship the `pnpmfile` (`pnpmfile.mjs`/`pnpmfile.cjs` from `src/pnpmfile.ts`) that pnpm loads as the config dependency's hook.

Note the toolchain field: this package uses `@typescript/native-preview` at `catalog:silk` (not `@effect/tsgo` at `catalog:effect`) — it is infra riding the silk tooling catalog, deliberately outside the v4 toolchain split that the [package-setup.md](../package-setup.md) library packages observe.

## Maintainer workflows

Three root scripts drive catalog maintenance (they regenerate the plugin's own definitions — they are **not** end-user commands):

- **`pnpm pnpm:up`** (`rolldown-pnpm-config upgrade savvy.build.ts`) — pins each `effect` / `@effect/*` package to its latest v4 release, then inspects the shared peer dependencies and recomputes the `effectPeers` floor for each. This is how the catalogs advance as new betas land.
- **`pnpm pnpm:export`** (`rolldown-pnpm-config export`) — exports the generated catalogs to the monorepo root `pnpm-workspace.yaml` and surfaces any inconsistency between the plugin's definitions and what the workspace currently pins.
- **`pnpm pnpm:preview`** (`rolldown-pnpm-config preview`) — previews the generated catalog output without writing.

## Consumer usage

Installing the config dependency gives a workspace both catalogs. The two consumer patterns:

- **Applications** reference the pinned versions directly in `dependencies` (`"effect": "catalog:effect"`), so the app always runs the current Effect.
- **Libraries** pin the dev version and declare the calculated floor as the peer range consumers must satisfy: `catalog:effect` in `devDependencies`, `catalog:effectPeers` in `peerDependencies`. This keeps the library building against current Effect while advertising the widest compatible peer range.

The end-user-facing half of this (install + the two patterns) is the package [README](../../../../packages/pnpm-plugin-effect/README.md); the maintainer workflows above are intentionally kept out of the README.

## Relationship to the workspace peer discipline

The `effect` / `effectPeers` catalogs this package defines are the mechanism behind the [peer-dependency discipline](../effect-standards.md#peer-dependency-discipline) in the standards: `@effected/*` libraries keep `effect` as a `catalog:effect` peer, and the interim pnpm-resolver configuration (`autoInstallPeers`, the `@effect/tsgo`-as-typechecker choice) that keeps the v4 beta from poisoning the v3 silk toolchain operates over the catalogs generated here. Advancing the beta is a single `pnpm pnpm:up` + `pnpm pnpm:export` — **user-run commands; agents must not invoke them.**

**Corrected 2026-07-09:** this section previously listed `dedupePeerDependents: false` among the live settings. The key is not present in `pnpm-workspace.yaml`, in an `.npmrc` (there is none), or in this package's source; it was removed once the peer-poisoning was fixed. `dedupeDirectDeps: false` was also dropped once pnpm 11.11.0 landed the upstream peer-resolution fix (see [effect-standards.md](../effect-standards.md#the-upstream-pnpm-fix-landed-2026-07-09)); neither key is set, and pnpm's defaults apply.

This package is **repo infrastructure that is also a public, shipped package.** It carries no pure/boundary tier — the library taxonomy does not apply — but it is a real npm-targeted package (`publishConfig.targets.npm` is `true`) that releases with the kit, intended so consumers can pin their `effect` dependencies and peer floors at the values this repo built and tested against rather than resolving their own. That payoff lands with `app-kit`: an application wiring up the kit adopts the same calculated versions in one step. Its value was largest under Effect v3, where computing peer floors by hand was genuinely hard; v4 makes that easier, so it is optional for the consumer — but it is a supported, shipped option, not an internal tool that happens to be publishable.

## Publishing

**It publishes to npm with the kit, at `0.1.0`, on the release gate like every other package** ([releases.md](../releases.md#versioning)). Nothing here has published yet — it is at `0.0.0` and `npm view` 404s — but that is true of all sixteen packages and distinguishes this one from none of them.

It is not a *library*: no library here depends on it, it depends on none, and the three-tier taxonomy does not describe it. That makes it structurally free to release on its own schedule, and for a while this doc claimed it therefore *would*. It does not. **Being unblocked by the kit is not the same as being excluded from it**, and the release is coordinated by design so consumers get one internally consistent graph on day one — the plugin included, since its entire purpose is to hand consumers the same pinned `effect` versions the kit was built against.

The inference that produced the earlier error is worth naming so nobody repeats it: `npm view` 404s and the manifest says `"private": true` and `0.0.0`. **None of that is evidence about release intent.** Every source manifest in this repo is `"private": true`; the bundler's `publishConfig` transform emits the publishable one at build time. This package's `publishConfig.targets.npm` is `true`, byte-identical to `semver`'s and `config-file`'s.

`private: true` in source with `publishConfig` (`access: public`, `directory: dist/dev/pkg`, `linkDirectory: true`, npm target) — the same build-time-transform-to-publishable pattern as the library packages ([package-setup.md](../package-setup.md)). Its purpose in publishing is to let external Effect workspaces adopt the same catalog strategy. The initial release is tracked by a changeset in `.changeset/`.
