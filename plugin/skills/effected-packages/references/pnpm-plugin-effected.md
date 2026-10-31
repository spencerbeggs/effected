# @effected/pnpm-plugin-effected

The kit's one **companion** package (a category, not a tier): published and installable, but not a library — there is no *application-facing* API to import. It is a pnpm **config dependency** that serves one pnpm catalog, `effected`, holding the Effect family and the whole kit at the versions the kit is built and tested against.

Its source exports one value from the published entrypoint — `catalogs` from `@effected/pnpm-plugin-effected`, the folded consumer catalog as a `ReadonlyMap` — plus `hooks` from an internal `src/pnpmfile.ts` module that carries no package.json export path (pnpm's config-dependency loader finds the built `pnpmfile.mjs` by convention). Both exist for pnpm's own tooling; nothing in a normal application dependency graph imports either.

## Install (pnpm 11+, config install — not a normal add)

```bash
pnpm add --config @effected/pnpm-plugin-effected
```

This writes a `configDependencies` entry into the workspace's `pnpm-workspace.yaml`. Installing it any other way does NOT activate its catalog or hooks.

The entry is a plain version (`"@effected/pnpm-plugin-effected": <version>`), the canonical form; pnpm still honours a `+sha512-…` suffix if one is present, but none is needed. A workspace that sets `minimumReleaseAge` lists `@effected/pnpm-plugin-effected` in `minimumReleaseAgeExclude`, so a fresh plugin release installs.

## What it ships

**One catalog, `effected`**, and a pnpmfile.

- **`catalog:effected`** — `effect`, every `@effect/*` package, `@effect/tsgo` and every published `@effected/*` package except the plugin itself. It is the only catalog name a consumer writes: in `dependencies`, `devDependencies` and `peerDependencies` alike.
  - **The Effect family is held to one minor with a tilde** (`~4.1.1`, so `>=4.1.1 <4.2.0`), not a caret. A new Effect minor reaches a consumer only through a new plugin release. `@effect/tsgo` stays on its own `0.x` line with its own range.
  - **Kit packages carry their current release** as a caret, which on `0.x` pins the minor.
  - The exact version a repo builds against is its **lockfile's resolution**, not the catalog literal; re-pin a vendored `.repos/effect` whenever that resolution moves.
- **There is no `catalog:effect`, `catalog:effect:peers` or `catalog:effected:peers`.** The plugin's `updateConfig` hook folds its declared catalogs into `effected` and deletes the rest, so a manifest still naming one fails the install. A consumer's own `effected` entry wins over the plugin's for the same package; a consumer's other catalogs are kept.
- **A published peer takes the install range.** `pnpm pack` runs no hook and resolves `catalog:effected` to the catalog's range, so a library's packed manifest advertises `effect: ~4.1.1` and an `@effected/*` peer at its current patch. When a library needs a wider peer, write that range by hand in its own manifest.
- **`@effected/pnpm-plugin-effected` is deliberately absent from its own catalog.** Catalogue it and every catalog rewrite bumps the plugin, which invalidates the catalog — a release loop with no termination condition.

The pnpmfile also applies, to every consumer:

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

Library — the same catalog on both sides:

```json
{
 "devDependencies": { "effect": "catalog:effected", "@effected/workspaces": "catalog:effected" },
 "peerDependencies": { "effect": "catalog:effected", "@effected/workspaces": "catalog:effected" }
}
```

Upgrading is `pnpm update --config @effected/pnpm-plugin-effected` (restore the hashes again), then a fresh resolve; every `catalog:effected` specifier moves at once.

## Testing machinery

One suite, `__test__/catalog.test.ts`:

- **The `effected` declaration.** It reads the `PnpmConfigPlugin(...)` literal from `savvy.build.ts` the way the upgrade CLI does, without importing it, and asserts every publishable package except the plugin is a member.
- **The `effect` declaration.** Every 4.x entry is held to one minor under `lock-minor` at `effect`'s own version.
- **The overrides.** It imports the built `pnpmfile.mjs` and checks the family pins merge with a consumer's own `overrides`, with a consumer value for the same selector winning.
- **The consumer's catalog.** The hook exposes exactly one catalog, `effected`, carrying the Effect family and the kit, and keeps a consumer's own catalogs.

## Gotchas

- pnpm-only: config dependencies and catalogs have no npm/yarn equivalent.
- It is a real public package, released with the kit. Its source manifest says `"private": true` like every package here; the bundler's `publishConfig` transform produces the publishable manifest.
- The catalog is a convenience rather than a necessity — optional, but shipped and supported.
