---
type: DataModel
title: The effected catalog literal
description: "The inline PnpmConfigPlugin call in savvy.build.ts declaring the one effected catalog, holding the Effect family and the kit, that the catalogs, the derived family pins and the allowed-versions table are generated from."
status: stable
resource: ../../packages/pnpm-plugin-effected/savvy.build.ts
tags:
  - release
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-11-01T21:43:51Z
integrity:
  generated:
    body: 28c2cc17c88d774e
---

# The effected catalog literal

## Shape

`packages/pnpm-plugin-effected/savvy.build.ts` calls `PnpmConfigPlugin({ ... })`
with a `catalogs` object carrying one declared catalog, `effected`, which
generates an `effected:peers` twin from its `peer` fields; see [the one
declared effected catalog](../decisions/one-declared-effected-catalog.md).
Its `packages` map holds one entry per package name: the Effect family
first, then the kit. Every entry is an object of the same three fields:
`range` (the version the catalog installs, or for a kit package its
next-release version), `peer` (the input the peer-floor computation
reads, which becomes the `:peers` twin's value) and `strategy`. Every
entry uses `"lock-minor"`. Each `effect` and `@effect/*` entry's `range`
is a tilde on the current Effect minor
(`~4.<minor>.<patch>`) and its `peer` is that tilde floored to the minor
(`~4.<minor>.0`), so no upgrade can cross a minor; see
[the effect catalog holds one minor](../decisions/effect-catalog-minor-lock.md).
`@effect/tsgo`, which versions on its own 0.x line, takes a caret on that
line under the same strategy, which on 0.x already holds the minor. On a kit
entry `"lock-minor"` floors each peer's patch.
Kit entries additionally carry `source: "workspace"`, telling the
upgrade CLI to resolve the version from this workspace rather than
treating `range` as an already-final value.

The literal also carries an `overridesFromCatalogs` directive, whose
`include` patterns (`effect`, `@effect/*`) select the family inside the
one catalog and match no `@effected/*` name, from which the build derives
the family pins (`"<name>@^4.0.0": "<catalog version>"`
for `effect` and every satellite, and `@effect/tsgo` pinned on its own 0.x line), and an
authored `overrides` block holding only the scoped release-candidate
`platform-node-shared` pins; see [the derived pins and scoped overrides](../modules/pnpm-plugin-effected.md#the-derived-family-pins-and-the-scoped-platform-node-shared-overrides).

A `peerDependencyRules.allowedVersionsFromCatalogs` block sits alongside
`catalogs`, naming the source catalog (`effected`) and the peer each rule
targets (`effect`) for [the generated allowed-versions
rules](../modules/pnpm-plugin-effected.md#the-allowed-versions-rules). No entry is exact, so it derives no rule.

## What derives from it

`rolldown-pnpm-config export` reads this literal and writes the root
`pnpm-workspace.yaml`'s `effected` and `effected:peers` catalogs and the derived
`peerDependencyRules.allowedVersions` table. `rolldown-pnpm-config
upgrade` (the CLI behind [`catalog:sync` /
`catalog:check`](../interfaces/catalog-sync-cli.md)) reads and rewrites
the kit's entries in place, resolving each `source:
"workspace"` package's next-release version. Run over the Effect-family
entries (`pnpm pnpm:up`, or the sync's `upgrade --yes`), it moves each entry
to its newest release inside the range, keeping the operator, so a tilde
entry takes a new patch and never a new minor. It never rewrites
`overrides`. The published package's `catalogs` export and `hooks` are
built from this same literal, but a consumer never sees the `:peers`
twin: the plugin's `updateConfig` hides it, leaving one catalog,
`effected`, and `catalogs` exports that same catalog; see
[consumers see one catalog](../decisions/consumer-catalog-fold.md).

## What breaks if an entry is wrong

An Effect-family entry with the wrong `range` or `peer` moves
every `@effected/*` package's devDependency range or advertised peer
away from the release the kit builds and tests against, and a `range`
that resolves outside the tag `.repos/effect` is pinned to lets the
vendored source describe a surface that is not installed. A satellite
`range` ahead of `effect`'s own pairs a satellite with a core it was not
built for, which dies at import; `__test__/catalog.test.ts` fails when any
4.x entry differs from `effect`, and the derived family pins hold every
consumer graph to that one version — see [the effect family is pinned by
overrides derived from the catalog](../decisions/effect-overrides-derived-from-catalog.md).
A non-exact `range` also changes the allowed-versions table: the
generator emits a rule only for an exact entry. A kit package missing
from the catalog entirely is invisible to `rolldown-pnpm-config
upgrade`, which walks the literal and can only report on packages it
already names — see [the catalog:sync / catalog:check
CLI](../interfaces/catalog-sync-cli.md) for how the sync script's own
membership computation catches that gap instead. A kit entry with a stale
`range` — one that was bumped only as a dependency
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
