# @effected/pnpm-plugin-effect

[![npm](https://img.shields.io/npm/v/@effected%2Fpnpm-plugin-effect?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/pnpm-plugin-effect)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-f69220.svg)](https://pnpm.io/)

A pnpm [config dependency](https://pnpm.io/config-dependencies) that centralizes versioning for two package sets through four [pnpm catalogs](https://pnpm.io/catalogs). The `effect` pair covers `effect` and its `@effect/*` satellites on one [Effect v4](https://effect.website/blog/releases/effect/40-beta/) release, plus `@effect/tsgo` at its own independent pin; the `effected` pair covers every published `@effected/*` package except this one. Each pair has a catalog for the versions you depend on and a second one for the ranges you advertise as peers, so a library does not over-constrain the applications that install it. Install it once and all four catalogs are available to every package in your workspace.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 prerelease. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/pnpm-plugin-effect

Effect ships as a couple of dozen packages that have to move together. Pin them by hand and the pins drift: one `@effect/*` package advances, its `effect` peer no longer matches the core you installed, and the failure surfaces as a type error in a file nobody touched. Keeping the pins in one place is the whole idea, and pnpm catalogs are the mechanism — `catalog:effect` in a manifest instead of a version string, and one place to edit when the pin advances.

The `@effected/*` kit has the same problem with a sharper edge. Every kit package is on `0.x`, where a caret does not cross a minor, so a hand-written `^0.14.0` stops resolving anything current the moment that package cuts `0.15.0`. Spread across a dozen manifests, those ranges rot quietly and independently, and nothing tells you a package has fallen two minors behind until an install refuses to give you anything current. `catalog:effected` replaces the ranges with a name, and upgrading the config dependency moves the whole kit surface at once.

The peer catalogs are the part you cannot get from a catalog alone. A library's `peerDependencies` should be as *wide* as it can safely be, while its `devDependencies` should be as *specific* as possible; those are different numbers and computing the peer floor by hand across a whole ecosystem is grim. `effect:peers` and `effected:peers` are that computation, done once. This is a convenience, not a requirement — it packages the way [effected](https://github.com/spencerbeggs/effected) pins its own dependencies, so a project that wants the same discipline can adopt it instead of rebuilding it. It ships catalogs and a pnpmfile, not a code API.

## Install

Add it as a **config dependency** — not a regular dependency. Config dependencies are installed ahead of the rest of the tree, which is what lets them contribute catalogs and hooks to the install that follows:

```bash
pnpm add --config @effected/pnpm-plugin-effect
```

Requires pnpm 11 or newer, and Node.js >=24.11.0. There is no npm or yarn equivalent: config dependencies and catalogs are pnpm features.

The command writes the package into your `pnpm-workspace.yaml`:

```yaml
configDependencies:
  "@effected/pnpm-plugin-effect": <version>+sha512-...
```

**Check that file afterwards, and expect to fix it by hand.** On pnpm 11.24.0 `pnpm add --config` writes the new entry **without** an integrity hash, and strips the `+sha512-…` suffix from every *other* config dependency already listed — including ones the command had no reason to touch. A later `pnpm install` does not restore them. Config dependencies are installed ahead of everything else and can contribute hooks that run during install, so the integrity pin is the thing standing between you and an unverified package with that reach.

Hand-written hashes are accepted and preserved, so the fix is to put them back:

```yaml
configDependencies:
  "@effected/pnpm-plugin-effect": 0.6.11+sha512-...
  "@your-org/other-config-dep": 1.2.3+sha512-...   # restore this one too
```

You can read the correct hash for a version out of the registry:

```bash
npm view "@effected/pnpm-plugin-effect@<version>" dist.integrity
```

## Usage

Once installed, all four catalogs are available to every package in the workspace. Reference them from `package.json` by name, in place of a version range. Which field they go in depends on whether you are building an application or a library.

Applications pin the versions directly, in `dependencies`:

```json
{
  "dependencies": {
    "effect": "catalog:effect",
    "@effect/ai-openai": "catalog:effect",
    "@effected/workspaces": "catalog:effected"
  }
}
```

Libraries want both halves of each pair: the pinned versions to develop and test against, and the computed floor as the peer range consumers must satisfy.

```json
{
  "devDependencies": {
    "effect": "catalog:effect",
    "@effected/workspaces": "catalog:effected"
  },
  "peerDependencies": {
    "effect": "catalog:effect:peers",
    "@effected/workspaces": "catalog:effected:peers"
  }
}
```

pnpm rewrites `catalog:` specifiers to concrete ranges when it publishes, so what lands on the registry is an ordinary manifest. Nothing downstream needs this plugin, or pnpm.

## What it ships

| Catalog | Contents | Use it in |
| ------- | -------- | --------- |
| `catalog:effect` | Every `effect` and `@effect/*` package, pinned to one v4 release | `dependencies` for applications, `devDependencies` for libraries |
| `catalog:effect:peers` | The same package set at the computed shared peer floor | `peerDependencies` for libraries |
| `catalog:effected` | Every published `@effected/*` package at its current release | `dependencies` for applications, `devDependencies` for libraries |
| `catalog:effected:peers` | The same package set at its minor-floored peer range | `peerDependencies` for libraries |

`@effected/pnpm-plugin-effect` itself is deliberately absent from the `effected` catalogs — it is the package the catalogs ship inside, and listing it would make every catalog rewrite bump the package that carries the catalog.

It also ships a pnpmfile, which pnpm loads from the config dependency automatically. There is nothing to import and nothing to call — the package has no code API, only configuration.

The `effect` catalogs move when the Effect pin advances, which is a deliberate, human-run upgrade. The `effected` catalogs are rebuilt automatically as kit packages release, so each new version of this package carries the kit's current versions; upgrading the config dependency is how a consumer picks them up.

```bash
pnpm update --config @effected/pnpm-plugin-effect
pnpm install
# every catalog: specifier in the workspace re-resolves to the new pins
```

While the whole ecosystem is pinned to a single Effect v4 prerelease, the two `effect` catalogs largely coincide. The floor computation earns its keep once the packages' releases desynchronize — and it earned it under Effect v3, where the floors genuinely diverged. The `effected` pair diverges routinely, because a kit package's dependency entry tracks its exact release while its peer range is floored to the minor.

## License

[MIT](LICENSE)
