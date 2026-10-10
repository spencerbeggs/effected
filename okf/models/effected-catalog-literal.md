---
type: DataModel
title: The effected catalog literal
description: "The inline PnpmConfigPlugin call in savvy.build.ts declaring the catalogs object that every kit catalog and the derived allowed-versions table is generated from."
status: stable
resource: ../../packages/pnpm-plugin-effect/savvy.build.ts
tags:
  - release
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-10-10T23:08:17Z
  body_sha256: d344f6149aed50c4d8dd6f4c3ccd85f642e72501f166ef2239a0521bb5f6d31c
---

# The effected catalog literal

## Shape

`packages/pnpm-plugin-effect/savvy.build.ts` calls `PnpmConfigPlugin({ ... })`
with a `catalogs` object carrying two declared catalogs, `effect` and
`effected`; each generates a `:peers` twin from its `peer` fields, so four
named catalogs result — `effect`, `effect:peers`, `effected` and
`effected:peers`. Each catalog's `packages` map holds one entry per
package name, and every entry is an object of the same three fields:
`range` (the version this catalog installs, or for `effected` the
package's next-release version), `peer` (the input the peer-floor
computation reads, which becomes the `:peers` twin's value) and
`strategy`. The `effect` catalog uses `"lock"`: every entry's `range` is
an exact version and its `peer` is identical, `4.0.2` for `effect` and
every `@effect/*` satellite and `0.51.1` for `@effect/tsgo`, which versions
on its own line. `lock` emits the peer verbatim, operator included. The
`effected` catalog uses `"lock-minor"`, which floors each peer's patch.
`effected` entries additionally carry `source: "workspace"`, telling the
upgrade CLI to resolve the version from this workspace rather than
treating `range` as an already-final value.

The literal also carries an `overrides` block: the HOLD entries
(`"<name>@^4.0.0": "4.0.2"` for `effect` and every satellite) and the
scoped release-candidate `platform-node-shared` pins; see [the scoped overrides](../modules/pnpm-plugin-effect.md#the-scoped-platform-node-shared-overrides).

A `peerDependencyRules.allowedVersionsFromCatalogs` block sits alongside
`catalogs`, naming the source catalog (`effect`) and the peer each rule
targets (`effect`) for [the generated allowed-versions
table](../modules/pnpm-plugin-effect.md#the-generated-allowed-versions-table).

## What derives from it

`rolldown-pnpm-config export` reads this literal and writes the root
`pnpm-workspace.yaml`'s Effect catalogs and the derived
`peerDependencyRules.allowedVersions` table. `rolldown-pnpm-config
upgrade` (the CLI behind [`catalog:sync` /
`catalog:check`](../interfaces/catalog-sync-cli.md)) reads and rewrites
the `effected` catalog's entries in place, resolving each `source:
"workspace"` package's next-release version. Run over the `effect`
catalog (`pnpm pnpm:up`, or the registry bot), it moves each entry to its
latest release, keeping an exact operator exact. It never rewrites
`overrides`. The published npm package's
`catalogs` and `hooks` virtual modules — what a consumer's pnpm actually
installs as `catalog:effect`, `catalog:effected`, and so on — are built
from this same literal.

## What breaks if an entry is wrong

An entry with the wrong `range` or `peer` under the `effect` catalog moves
every `@effected/*` package's devDependency range or advertised peer
away from the release the kit builds and tests against, and a `range`
that resolves outside the tag `.repos/effect` is pinned to lets the
vendored source describe a surface that is not installed. A satellite
`range` ahead of `effect`'s own pairs a satellite with a core it was not
built for, which dies at import; `__test__/catalog.test.ts` fails when any
4.x entry differs from `effect` — see [the effect catalog locks every
entry to an exact version](../decisions/effect-catalog-locked-exact.md).
A non-exact `range` also changes the allowed-versions table: the
generator emits a rule only for an exact entry. An entry missing
from the `effected` catalog entirely is invisible to `rolldown-pnpm-config
upgrade`, which walks the literal and can only report on packages it
already names — see [the catalog:sync / catalog:check
CLI](../interfaces/catalog-sync-cli.md) for how the sync script's own
membership computation catches that gap instead. An entry with a stale
`range` under `effected` — one that was bumped only as a dependency
ripple and never wrote its own changeset — makes a consumer's resolved
`@effected/*` range look satisfied while actually excluding the release
that motivated the bump; see [the effected catalog holds next-release
versions](../decisions/catalog-holds-next-release-versions.md).

## Why it must stay inline

`rolldown-pnpm-config upgrade`'s CLI finds the catalog by statically
walking the `PnpmConfigPlugin(...)` call argument for
`.catalogs.<name>.packages`. Hoisting the literal into an exported
`const` makes it invisible to that static walk. `savvy.build.ts` is
itself a top-level `await build({...})` call, so a test cannot import it
either — the package's own `__test__/catalog.test.ts` reads the source
text the same way the CLI does, which is why that parsing approach exists
at all rather than importing a value.

## Why the plugin never appears in its own catalog

See [the plugin is never in its own catalog](../decisions/plugin-never-in-its-own-catalog.md).
