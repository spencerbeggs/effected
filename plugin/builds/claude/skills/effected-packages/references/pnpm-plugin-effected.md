# @effected/pnpm-plugin-effected

The kit's one **companion** package (a category, not a tier): published and installable, but not a library — there is no *application-facing* API to import. It is a pnpm **config dependency** that serves two pnpm catalogs: `effected`, holding the Effect family and the whole kit at the versions the kit is built and tested against, and `effected:build`, holding the build chain `effected package build` runs.

Its source exports one value from the published entrypoint — `catalogs` from `@effected/pnpm-plugin-effected`, the consumer catalogs `effected` and `effected:build`, as a `ReadonlyMap` — plus `hooks` from an internal `src/pnpmfile.ts` module that carries no package.json export path (pnpm's config-dependency loader finds the built `pnpmfile.mjs` by convention). Both exist for pnpm's own tooling; nothing in a normal application dependency graph imports either.

## Install (pnpm 11+, config install — not a normal add)

```bash
pnpm add --config @effected/pnpm-plugin-effected
```

This writes a `configDependencies` entry into the workspace's `pnpm-workspace.yaml`. Installing it any other way does NOT activate its catalog or hooks.

The entry is a plain version (`"@effected/pnpm-plugin-effected": <version>`), the canonical form; pnpm still honours a `+sha512-…` suffix if one is present, but none is needed. A workspace that sets `minimumReleaseAge` lists `@effected/pnpm-plugin-effected` in `minimumReleaseAgeExclude`, so a fresh plugin release installs.

## What it ships

**Two catalogs, `effected` and `effected:build`, each with a `:peers` twin**, and a pnpmfile. Write the plain catalog in `dependencies` and `devDependencies`, and the `:peers` twin in `peerDependencies`.

- **`catalog:effected`** — `effect`, every `@effect/*` package, `@effect/tsgo` and every published `@effected/*` package except the plugin itself. It is the catalog name a consumer writes for anything its code runs on, in `dependencies` and `devDependencies`.
  - **The Effect family is served at the exact version the plugin pins graph-wide** (`4.<minor>.<patch>`), not a range. pnpm never applies a version-selector override to a `catalog:` specifier, so a range here would let a newer patch resolve beside the pinned one. A new Effect patch or minor reaches a consumer through a new plugin release. `@effect/tsgo` is pinned the same way on its own `0.x` line.
  - **Kit packages carry their current release** as a caret, which on `0.x` pins the minor.
  - The exact version a repo builds against is its **lockfile's resolution**, not the catalog literal; re-pin a vendored `.repos/effect` whenever that resolution moves.
- **`catalog:effected:build`** — the build chain and toolchain: `tsdown`, `@tsdown/exe`, `rolldown`, `rolldown-plugin-dts`, `@microsoft/api-extractor`, `@microsoft/api-extractor-model`, `@microsoft/tsdoc`, `@microsoft/tsdoc-config`, `typescript`, `@types/node`, `tsx`, `react`, `react-dom`, `@types/react`, `@types/react-dom` and `@rsbuild/core`. A repository that builds with `effected package build` takes these from here, not from `@savvy-web/pnpm-plugin-silk`'s `catalog:build`. No override is derived from it, and the pnpmfile allows a TypeScript 7.1 prerelease under `tsdown`, whose own `typescript` peer admits none.
- **`catalog:effected:peers` and `catalog:effected:build:peers`** — the same members with each range floored to its minor: `~4.<minor>.0` for the Effect family, `^0.<minor>.0` for a kit package. `pnpm pack` writes a `catalog:` specifier as the served catalog's value, so a peer spelled `catalog:effected` publishes an exact Effect version and pins every consumer to that patch. Spell every peer `catalog:effected:peers` (or `catalog:effected:build:peers`). When a library needs a wider peer than the floor, write that range by hand.
- **There is no `catalog:effect` or `catalog:effect:peers`**, so a manifest still naming one fails the install. A consumer's own entry in a catalog the plugin serves wins over the plugin's for the same package, and a local `catalogs.effected` block left by an earlier export keeps its old ranges until it is re-exported or deleted; a consumer's other catalogs are kept.
- **`@effected/pnpm-plugin-effected` is deliberately absent from its own catalog.** Catalogue it and every catalog rewrite bumps the plugin, which invalidates the catalog — a release loop with no termination condition.

The pnpmfile also applies, to every consumer:

- **A public hoist of `@effected/plugin`**, so the `effected` and `effected-mcp` bins resolve from any workspace package, not only the root.

- **Graph-wide Effect overrides**, one per family member (`"<name>@^4.0.0": "<catalog version>"`, and the same for `@effect/tsgo` on its own line), derived from the catalog so they move with it. They hold every `effect` and satellite in the graph — including a dependency's own dependencies, which a catalog never reaches — to one version. Never hand-write these pins. A consumer's own `overrides` are kept, and a consumer value for the same selector wins.
- **Release-age exclusion:** `effect`, `@effect/*` and `@effect/tsgo-*` are exempt from `minimumReleaseAge`, so a pinned Effect release only hours old still installs.

## Usage (in a consuming workspace's package manifests)

Application:

```json
{
 "dependencies": {
  "effect": "catalog:effected",
  "@effect/platform-node": "catalog:effected",
  "@effected/workspaces": "catalog:effected"
 }
}
```

Library — the plain catalog for the dev copy, the `:peers` twin for the peer:

```json
{
 "devDependencies": { "effect": "catalog:effected", "@effected/workspaces": "catalog:effected" },
 "peerDependencies": { "effect": "catalog:effected:peers", "@effected/workspaces": "catalog:effected:peers" }
}
```

A package built with the kit takes its toolchain from the build catalog:

```json
{
 "devDependencies": {
  "@effected/plugin": "catalog:effected",
  "typescript": "catalog:effected:build",
  "@types/node": "catalog:effected:build"
 }
}
```

Upgrading is `pnpm update --config @effected/pnpm-plugin-effected` (restore the hashes again), then a fresh resolve; every `catalog:effected` specifier moves at once.

## Testing machinery

One suite, `__test__/catalog.test.ts`:

- **The `effected` declaration.** It reads the `PnpmConfigPlugin(...)` literal from its `effected.toml` plugin module (`lib/build/pnpm-config.plugin.ts`) the way the upgrade CLI does, without importing it, and asserts every publishable package except the plugin is a member.
- **The `effect` declaration.** Every 4.x entry is held to one minor under `lock-minor` at `effect`'s own version.
- **The overrides.** It imports the built `pnpmfile.mjs` and checks the family pins merge with a consumer's own `overrides`, with a consumer value for the same selector winning.
- **The `effected:build` declaration.** It holds exactly the build chain, names nothing from the kit or the Effect family, and no derived override targets one of its members.
- **The consumer's catalogs.** The hook serves `effected` (the Effect family pinned exactly, and the kit) and `effected:build`, each with its floored `:peers` twin, and keeps a consumer's own catalogs.

## Gotchas

- pnpm-only: config dependencies and catalogs have no npm or bun equivalent.
- It is a real public package, released with the kit. Its source manifest says `"private": true` like every package here; the bundler's `publishConfig` transform produces the publishable manifest.
- The catalog is a convenience rather than a necessity — optional, but shipped and supported.
