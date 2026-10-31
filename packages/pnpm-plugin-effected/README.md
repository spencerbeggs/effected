# @effected/pnpm-plugin-effected

[![npm](https://img.shields.io/npm/v/@effected%2Fpnpm-plugin-effected?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/pnpm-plugin-effected)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-f69220.svg)](https://pnpm.io/)

A pnpm [config dependency](https://pnpm.io/config-dependencies) that centralizes versioning for the Effect ecosystem and the `@effected/*` kit through one [pnpm catalog](https://pnpm.io/catalogs), `effected`. It covers `effect` and its `@effect/*` satellites on one [Effect v4](https://effect.website/) minor, `@effect/tsgo` at its own independent pin, and every published `@effected/*` package except this one. Install it once and `catalog:effected` is available to every package in your workspace, in dependencies and peer ranges alike.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on stable
> Effect v4 (`effect` `~4.1.0`) and still in `0.x` development. Stable Effect
> makes a kit `1.0.0` possible, not automatic. To keep your `effect` and
> `@effect/*` versions on the line the kit is built and tested against, install
> this package as a config dependency (below).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/pnpm-plugin-effected

Effect ships as a couple of dozen packages that have to move together. Pin them by hand and the pins drift: one `@effect/*` package advances, its `effect` peer no longer matches the core you installed, and the failure surfaces as a type error in a file nobody touched, or as a crash at import. Keeping the pins in one place is the whole idea, and pnpm catalogs are the mechanism — `catalog:effected` in a manifest instead of a version string, and one place that moves when the pin advances.

The `@effected/*` kit has the same problem with a sharper edge. Every kit package is on `0.x`, where a caret does not cross a minor, so a hand-written `^0.14.0` stops resolving anything current the moment that package cuts `0.15.0`. Spread across a dozen manifests, those ranges rot quietly and independently. `catalog:effected` replaces the ranges with a name, and upgrading the config dependency moves the whole kit surface at once.

A catalog only reaches the manifests you write. Your dependencies name `effect` and its satellites too, and a caret there can pair a satellite with a core it was not built for. The plugin's overrides close that gap across the whole graph. This is a convenience, not a requirement — it packages the way [effected](https://github.com/spencerbeggs/effected) pins its own dependencies, so a project that wants the same discipline can adopt it instead of rebuilding it. It ships a catalog and a pnpmfile, not a code API.

## Install

Add it as a **config dependency** — not a regular dependency. Config dependencies are installed ahead of the rest of the tree, which is what lets them contribute catalogs and hooks to the install that follows:

```bash
pnpm add --config @effected/pnpm-plugin-effected
```

Requires pnpm 11 or newer, and Node.js >=24.11.0. There is no npm or yarn equivalent: config dependencies and catalogs are pnpm features.

The command writes the package into your `pnpm-workspace.yaml` at a plain version:

```yaml
configDependencies:
  "@effected/pnpm-plugin-effected": <version>
```

A plain version is the canonical form. pnpm still honours a `+sha512-…` integrity suffix on the entry if one is there, but you do not need to add one.

If your workspace sets `minimumReleaseAge`, add the plugin to `minimumReleaseAgeExclude` so a release that is only hours old still installs:

```yaml
minimumReleaseAgeExclude:
  - "@effected/pnpm-plugin-effected"
```

## Usage

Once installed, `catalog:effected` is available to every package in the workspace. Reference it from `package.json` in place of a version range — in every dependency field.

An application:

```json
{
  "dependencies": {
    "effect": "catalog:effected",
    "@effect/ai-openai": "catalog:effected",
    "@effected/workspaces": "catalog:effected"
  }
}
```

A library uses the same catalog on both sides:

```json
{
  "devDependencies": {
    "effect": "catalog:effected",
    "@effected/workspaces": "catalog:effected"
  },
  "peerDependencies": {
    "effect": "catalog:effected",
    "@effected/workspaces": "catalog:effected"
  }
}
```

pnpm rewrites `catalog:` specifiers to concrete ranges when it packs, so what lands on the registry is an ordinary manifest. Nothing downstream needs this plugin, or pnpm. A packed peer advertises the catalog's range — `effect: ~4.1.1`, and each `@effected/*` package at its current release. If a library needs a wider peer, write that range by hand in its own manifest.

## What it ships

| Entries | Range | Notes |
| ------- | ----- | ----- |
| `effect` and every `@effect/*` package | one Effect minor, with a tilde (`~4.1.1`) | a new Effect minor arrives with a new plugin release, never through a range |
| `@effect/tsgo` | its own `0.x` line | versions independently of `effect` |
| every published `@effected/*` package | its current release, with a caret | on `0.x` a caret pins the minor |

There is one catalog. `catalog:effect`, `catalog:effect:peers` and `catalog:effected:peers` do not exist for a consumer, and a manifest that still names one fails the install. A `catalog:effected` entry you declare yourself wins over the plugin's for the same package, and your other catalogs are kept.

`@effected/pnpm-plugin-effected` itself is deliberately absent from the catalog — it is the package the catalog ships inside, and listing it would make every catalog rewrite bump the package that carries the catalog.

It also ships a pnpmfile, which pnpm loads from the config dependency automatically. There is nothing to import and nothing to call. Besides the catalog, the pnpmfile applies these settings to every consumer:

- **Effect family overrides:** one override per `effect` and `@effect/*` package, `"<name>@^4.0.0": "<catalog version>"`, derived from the catalog so it moves with it, and one for `@effect/tsgo` on its own line. They hold every copy in your graph, including the ones your dependencies name, to the catalog version, so a satellite can never pair with a core it was not built for. Never hand-write these pins.
- **Release-age exclusion:** `effect`, `@effect/*` and `@effect/tsgo-*` are exempt from `minimumReleaseAge`, so a pinned Effect release that is only hours old still installs.
- **Scoped overrides:** `@effect/platform-node-shared` is pinned to its parent's version under `@effect/platform-node@4.0.0-rc.117` and `@effect/platform-node@4.0.0-rc.118`. Tools still built on those release candidates take the shared package with a caret, and a fresh resolve would pair it with a newer one built for a different `effect`, which crashes the tool at startup. Each override applies only under its own parent, so a stable install is never touched.

Your own `overrides` are kept alongside the plugin's. If you set the same selector yourself, your value wins.

The Effect entries move when the kit advances its Effect pin. The kit entries are rebuilt automatically as kit packages release, so each new version of this package carries the kit's current versions; upgrading the config dependency is how a consumer picks them up:

```bash
pnpm update --config @effected/pnpm-plugin-effected
pnpm install
# every catalog:effected specifier in the workspace re-resolves to the new pins
```

## License

[MIT](LICENSE)
