---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-07-19
last-synced: 2026-07-16
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

### Absence means absorbed

The v4 `effect` catalog deliberately carries **no** entries for the packages Effect v4 absorbed into core: `@effect/platform`, `@effect/cluster`, `@effect/rpc`, `@effect/sql`, `@effect/workflow` and `@effect/experimental`. That absence **is** the removal signal — a consumer or migration agent looking one of these up in the catalog and finding nothing should read it as "this package no longer exists on the v4 line; its functionality lives in `effect` core", not as an oversight or a missing pin. Do not confuse them with the suffixed packages that still ship on v4 and are in the catalog (`@effect/platform-node`, the `@effect/sql-*` drivers, …); only the bare absorbed names are gone. The absorbed names still appear in the `effect3` catalog, where the v3 line legitimately carries them. This went undocumented during the savvy-web/systems migration and cost a verification pass — surfaced by the savvy-web/systems dogfood round, 2026-07-16.

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

The v3/v4 peer-resolution bug that once required pnpm-resolver workarounds is fixed upstream. Neither `dedupePeerDependents` nor `dedupeDirectDeps` is set anywhere — pnpm's defaults apply; only `autoInstallPeers: true` is set in `pnpm-workspace.yaml`.

A binding hazard once lived in **this package's context**, recorded in [effect-standards.md](../effect-standards.md#open-defect-one-peers-check-issue): the bundler 2.0 upgrade made `@savvy-web/bundler` depend on published `@effected/*` packages that peer on the exact Effect v4 beta, and with no `effect` of its own this package let pnpm bind those peers to the v3 that `rolldown-pnpm-config` carries — loading v4 code against v3 at build time. The fix (347ca229) is a direct `effect` (`catalog:effect`) **devDependency** here, purely to give the resolver the right version to bind; the companion still ships no `effect`-importing code, so do not "clean up" that devDependency as unused. The rolldown v3-satellite warnings that remained after that fix cleared with the 2026-07-18 toolchain update; the known-issue slot's current occupant class and its proposed structural remedy are the subject of the next section.

## Proposed: a generated peer allowed-versions table (2026-07-19, not yet implemented)

Every catalog advance strands the kit's previously-published artifacts: a registry `@effected/*` package peers on the exact beta it was built against under the `lock` strategy, so the moment the workspace installs the next beta its peer goes unmet and `pnpm peers check` gains a new rotating occupant of the known-issue slot (the rolldown v3 satellites, then `@effect/platform-node-shared` wanting beta.99 early, now `@effected/jsonc@0.2.0` wanting beta.98 late). The proposal, from the 2026-07-19 beta.99 advance: `pnpm:export` additionally generates a `peerDependencyRules.allowedVersions` table into the root `pnpm-workspace.yaml`, declaring the lock catalog's exact current beta an acceptable resolution for the `effect`-family peers of the kit's own artifacts, which retires the warning class structurally instead of documenting each occupant.

The rules are parent-scoped, never blanket. pnpm 11 supports `parent>peer` selectors in `allowedVersions` (verified in the installed 11.15.0: rules parse through `parsePkgAndParentSelector` and match by declaring parent, with the rule value checked as a semver range against the found version), and scoping is load-bearing: a blanket `effect: 4.0.0-beta.99` rule would also silence a genuine Effect v3 satellite's unmet `^3` peer, because `allowedVersions` matches the found version against the rule range regardless of what the parent asked for. The generator therefore emits one `"<pkg>>effect"` rule per `@effected/*` workspace member (a closed, kit-owned parent list — rules for parents absent from the installed graph never match and are harmless), valued at the lock catalog's exact beta only, regenerated on every export so the table advances in the same commit as the catalogs. The `effect3` interop satellites never match a scoped rule, so a v3-line defect still warns.

Costs and consequences, recorded up front: the table suppresses reporting only — it does not change resolution, so `autoInstallPeers` may still materialize an old-beta `effect` instance for a stranded artifact's subgraph, which is today's behavior and acceptable; the rule values must stay exact-version (a range would quietly widen what counts as satisfied and recreate the masking risk); and once implemented the CLAUDE.md dependency discipline retires from "exactly one known issue" to "`pnpm peers check` reports zero issues; any warning is a genuine closure defect to fix upstream", which is the stronger invariant this table exists to buy.

## Classification: companion

This package is the kit's [companion](../effect-standards.md#companion-packages-published-but-not-a-library): published and installable, exposing no API. It carries **no tier**, because tier answers "what does depending on this cost you?" and nothing can depend on it — there is nothing to import and nothing to call. What it ships is configuration (two pnpm catalogs and a pnpmfile), not code. The three-tier taxonomy classifies libraries and this is not one; `companion` is a category, not a fourth tier.

Its value was largest under Effect v3, where computing peer floors by hand was genuinely hard; v4 makes that easier, so **installing it is optional for the consumer** — but it is a supported, shipped option, not an internal tool that happens to be publishable. That payoff lands with `@effected/app`: an application wiring up the kit adopts the same calculated versions in one step.

## Publishing

It is a real npm-targeted package (`publishConfig.targets.npm` is `true`) that **publishes with the kit at `0.1.0`, on the release gate like every other package** ([releases.md](../releases.md#versioning)). Being a companion rather than a library makes it structurally free to release on its own schedule, but the release is coordinated by design so consumers get one internally consistent graph on day one — the companion included, since its purpose is to hand consumers the same pinned `effect` versions the kit was built against.

Do not infer release intent from surface signals: every source manifest in this repo is `"private": true`, `npm view` 404s for every package, and the bundler's `publishConfig` transform (`access: public`, `directory: dist/dev/pkg`, `linkDirectory: true`) emits the publishable manifest at build time ([package-setup.md](../package-setup.md)). This package's `publishConfig.targets.npm` is byte-identical to the library packages'. The initial release is tracked by a changeset in `.changeset/`.
