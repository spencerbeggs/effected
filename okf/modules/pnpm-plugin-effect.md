---
type: Module
title: pnpm-plugin-effect
description: The kit's companion pnpm config dependency — publishes the effect and effected catalogs that pin the whole ecosystem's versions.
status: stable
kind: package
resource: ../../packages/pnpm-plugin-effect
tags:
  - release
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T17:24:58Z
  body_sha256: 60f21558afeb84e5bb7d9f5534521e23f19d6f4e42a7aef36b50534d349c5035
---

# pnpm-plugin-effect

## Purpose

`@effected/pnpm-plugin-effect` is the kit's [companion](../glossary/companion-package.md)
package — published and installable, but not a library. It is a pnpm
**config dependency** (installed with `pnpm add --config`, not as a
normal dependency) that centralizes Effect-ecosystem versioning by
publishing pnpm catalogs. It is the single source of truth for what "the
current Effect version" means: every `@effected/*` package references
`catalog:effect` / `catalog:effect:peers`, and so can any external
workspace that installs it. It carries the kit's own version surface too,
so one installed config dependency pins both halves of what a consumer
builds against.

Four catalogs, and this is the whole set: `effect` (every `effect` /
`@effect/*` package on the v4 line, at a caret range on the stable line),
`effect:peers` (the same set as the advertised peer range), `effected`
(the kit's own packages, at the version each will next publish) and
`effected:peers` (the same set as the advertised peer range). Every name
is colon-form — see
[the retired effect3 interop catalogs](../decisions/effect3-catalogs-retired.md)
for the pair that must not come back.

Nothing can depend on this package — there is nothing to import and
nothing to call — so tier answers a question that does not apply. It is
a real npm-targeted package that publishes with the kit on the release
gate like every other package: being a companion makes it structurally
free to release on its own schedule, but the release is coordinated by
design so consumers get one internally consistent graph. **Installing it
is optional for the consumer** — a workspace can pin Effect by hand — but
shipping it is not optional for the release: it is a supported, shipped
option, not an internal tool that happens to be publishable.

## How it generates the catalogs

The catalog strategy is declared in
`packages/pnpm-plugin-effect/savvy.build.ts` via `rolldown-pnpm-config`'s
`PnpmConfigPlugin`. Each package entry carries a `range` (the pinned
version), a `peer` (the input to the floor computation) and a `strategy`.
Memberships, versions and strategies all live in that one file. See
[the effected catalog literal](../models/effected-catalog-literal.md) for
its shape and load-bearing constraints.

The `effect` (v4) catalog gives `effect` and every `@effect/*` satellite
the caret range `^4.0.0` and uses the `lock-minor` strategy, as the
[stable-line decision](../decisions/effect-catalog-tracks-stable-minor.md)
rules. `range` (what a workspace installs) and `peer` (the input to the
floor computation) are separate fields, and for these entries both read
`^4.0.0`, so `effect:peers` advertises the same caret. The catalog literal
does not fix the exact `effect`: the lockfile does, and `.repos/effect` is
pinned to the tag matching that resolution. `@effect/tsgo` versions on its
own line, so its entry differs: `range` is exact (`0.47.2`) and `peer`
is its floor (`0.47.0`).

`src/index.ts` and `src/pnpmfile.ts` are one-line re-exports over
`rolldown-pnpm-config` virtual modules; all real configuration lives in
`savvy.build.ts`. The build sets `bundleNodeModules: true` and uses
`looseFiles` to ship the pnpmfile (`pnpmfile.mjs` / `pnpmfile.cjs`) that
pnpm loads as the config dependency's hook.

The v4 `effect` catalog deliberately carries no entries for packages
Effect v4 absorbed into core (`@effect/platform`, `@effect/cluster`,
`@effect/rpc`, `@effect/sql`, `@effect/workflow`, `@effect/experimental`).
That absence *is* the removal signal — a consumer or migration agent
looking one of these up and finding nothing should read it as "this
package no longer exists on the v4 line; its functionality lives in
`effect` core," not as an oversight. The suffixed packages that still
ship on v4 (`@effect/platform-node`, the `@effect/sql-*` drivers) stay in
the catalog; only the bare absorbed names are gone.

## The effected catalog: the kit's own version surface

The `effected` / `effected:peers` catalogs list every publishable kit
package but one, in object form with a `range`, a `peer`,
`strategy: "lock-minor"` and `source: "workspace"`. They exist for
consumers, not for this workspace: internal edges stay `workspace:*`, and
these catalogs are not exported into the root `pnpm-workspace.yaml` the
way the Effect ones are. `@effected/pnpm-plugin-effect` is deliberately
absent from its own catalog — see
[the plugin is never in its own catalog](../decisions/plugin-never-in-its-own-catalog.md).
Publishability for membership purposes is always
`publishConfig.access === "public"`, never `private === false` — see
[the publishability-signal convention](../conventions/publishability-signal.md).
Entries hold **next-release** versions; see
[the effected catalog holds next-release versions](../decisions/catalog-holds-next-release-versions.md)
for what follows from that. Keeping the catalog current is automated —
see [the catalog:sync / catalog:check CLI](../interfaces/catalog-sync-cli.md).

## The retired effect3 interop catalogs

See [effect3 catalogs are retired](../decisions/effect3-catalogs-retired.md).

## The generated allowed-versions table

A `peerDependencyRules.allowedVersions` table in the root
`pnpm-workspace.yaml` declares a satellite's current pin an acceptable
resolution of its `effect` peer, so a peer that cannot be satisfied by
range does not leave a warning in `pnpm peers check`.

The table is derived, never hand-written. `PnpmConfigPlugin`'s
`peerDependencyRules.allowedVersionsFromCatalogs` option names the source
catalog and the peer each rule targets, and `rolldown-pnpm-config export`
emits the rules into the workspace file. It emits a rule **only for an
entry whose `range` is an exact version**, because a rule is a
version-qualified parent selector (`"<satellite>@<its pin>>effect"`) and a
caret range has no single version to qualify. With the `effect` catalog
on `^4.0.0`, that leaves one rule: `@effect/tsgo`'s, whose exact `range`
is its own line (`"@effect/tsgo@0.47.2>effect": 4.0.0`). Every other
satellite peers on `effect` with a caret that the installed copy
satisfies, so the stable line needs no table for them.

Rules are never blanket and never name-only, so pnpm applies a qualified
rule only when the actual parent instance's version satisfies the
qualifier — any other instance of the same satellite name, such as a
toolchain-carried release candidate, still warns on a genuinely unmet
peer. The scope is effect's own satellites, never the kit's own
`@effected/*` members, because the kit controls its own artifacts and the
republish cycle repairs their stranding properly — covering them here
would mask a real defect.

The table suppresses reporting only; it does not change resolution, so
`autoInstallPeers` may still materialize a second `effect` instance for a
stranded artifact's subgraph. A second copy is not always inert — a
lagging toolchain has mixed two `effect` copies into one `Schema` decode
pipeline and crashed every build — so keeping the workspace and toolchain
resolved to one `effect` copy remains the invariant this table's own
package does not solve.

## The scoped platform-node-shared overrides

The plugin also publishes a pnpm `overrides` block, which a consumer's
install applies. It holds two entries, one per release candidate whose
`@effect/platform-node` is still in use by built tools:

- `@effect/platform-node@4.0.0-rc.117>@effect/platform-node-shared`:
  `4.0.0-rc.117`
- `@effect/platform-node@4.0.0-rc.118>@effect/platform-node-shared`:
  `4.0.0-rc.118`

Each pins the shared package to its parent's own version. A tool built on
a release candidate takes `@effect/platform-node-shared` with a caret, and
a fresh resolve pairs it with the newest shared package, which was built
against a different `effect` than the tool runs. The rc.118 shared package
imports a module that rc.117 does not ship, and a tool on rc.117 crashed at
startup. A selector names its parent's exact version, so an entry never
touches a stable `4.x` install. Remove an entry once no tool consumers run
is built on that candidate. This is the `overrides` bridge shape from
[one resolved effect copy](../conventions/one-resolved-effect-copy.md),
published by the plugin rather than written per workspace.

## Maintainer workflows

Three root scripts drive catalog maintenance and are **user-run only** —
they rewrite this package's `savvy.build.ts` and the root
`pnpm-workspace.yaml`, mutating the lockfile on the next install:
`pnpm pnpm:up` (pin each Effect package to its latest v4 release and
recompute the peer floor), `pnpm pnpm:export` (write the generated
catalogs, allowed-versions table and overrides into `pnpm-workspace.yaml`,
and surface drift) and `pnpm pnpm:preview` (preview without writing).
Advancing the Effect pin is `pnpm:up` then `pnpm:export`, with the
`.repos/effect` submodule re-pinned to the lockfile's resolved `effect` in
the same commit — see
[advance the effect pin](../runbooks/advance-the-effect-pin.md).

The two `catalog:` scripts are a different class and **agents may run
them**: `pnpm catalog:sync` and `pnpm catalog:check` touch only
`savvy.build.ts` and one fixed-name changeset, never the lockfile or
`pnpm-workspace.yaml`, and CI runs them on every pull request to `main`
and to `changeset-release/main` — see
[the catalog:sync / catalog:check CLI](../interfaces/catalog-sync-cli.md).

## Consumer usage

Installing the config dependency gives a workspace the catalogs.
Applications reference the pinned versions directly in `dependencies`
(`"effect": "catalog:effect"`), so the app always runs the current
Effect. Libraries pin the dev version and declare the calculated floor as
the peer range: `catalog:effect` in `devDependencies`,
`catalog:effect:peers` in `peerDependencies`.

## Relationship to the peer discipline

These catalogs are the mechanism behind the kit's peer-dependency
discipline. Root `pnpm-workspace.yaml` sets exactly one
resolver-relevant key, `autoInstallPeers: true` — no
`dedupePeerDependents`, no `dedupeDirectDeps`, no `.npmrc`. This
package declares **no** `effect` devDependency, and that absence is
deliberate: it ships and tests no `effect`-importing code. The
devDependency it once carried steered the resolver to bind the bundler's
`@effected/*` peers to the workspace's `effect`, and once the build
toolchain carried its own `effect` the steering inverted and leaked the
workspace's copy into the toolchain's peers. Do not reintroduce it.
