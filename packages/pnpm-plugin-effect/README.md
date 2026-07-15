# @effected/pnpm-plugin-effect

[![npm](https://img.shields.io/npm/v/@effected%2Fpnpm-plugin-effect?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/pnpm-plugin-effect)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-f69220.svg)](https://pnpm.io/)

A pnpm [config dependency](https://pnpm.io/config-dependencies) that centralizes Effect-ecosystem versioning through two [pnpm catalogs](https://pnpm.io/catalogs). The `effect` catalog pins every `effect` and `@effect/*` package to one [Effect v4](https://effect.website/blog/releases/effect/40-beta/) release. The `effectPeers` catalog carries the same package set at a computed shared floor — the lowest version safe to advertise as a peer range — so a library you publish does not over-constrain the applications that install it. Install it once and both catalogs are available to every package in your workspace.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
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

Effect ships as a couple of dozen packages that have to move together. Pin them by hand and the pins drift: one `@effect/*` package advances, its `effect` peer no longer matches the core you installed, and the failure surfaces as a type error in a file nobody touched. Keeping the pins in one place is the whole idea, and pnpm catalogs are the mechanism — `catalog:effect` in a manifest instead of a version string, and one place to edit when the beta advances.

The second catalog is the part you cannot get from a catalog alone. A library's `peerDependencies` should be as *wide* as it can safely be, while its `devDependencies` should be as *specific* as possible; those are different numbers and computing the peer floor by hand across a whole ecosystem is grim. `effectPeers` is that computation, done once. This is a convenience, not a requirement — it packages the way [effected](https://github.com/spencerbeggs/effected) pins its own Effect dependencies, so a project that wants the same discipline can adopt it instead of rebuilding it. It ships catalogs and a pnpmfile, not a code API.

## Install

Add it as a **config dependency** — not a regular dependency. Config dependencies are installed ahead of the rest of the tree, which is what lets them contribute catalogs and hooks to the install that follows:

```bash
pnpm add --config @effected/pnpm-plugin-effect
```

Requires pnpm 11 or newer, and Node.js >=24.11.0. There is no npm or yarn equivalent: config dependencies and catalogs are pnpm features.

The command writes the package into your `pnpm-workspace.yaml`, filling in the version and the required integrity hash for you:

```yaml
configDependencies:
  "@effected/pnpm-plugin-effect": <version>+sha512-...
```

## Usage

Once installed, both catalogs are available to every package in the workspace. Reference them from `package.json` by name, in place of a version range. Which field they go in depends on whether you are building an application or a library.

Applications pin the versions directly, in `dependencies`:

```json
{
  "dependencies": {
    "effect": "catalog:effect",
    "@effect/ai-openai": "catalog:effect"
  }
}
```

Libraries want both catalogs: the pinned versions to develop and test against, and the computed floor as the peer range consumers must satisfy.

```json
{
  "devDependencies": {
    "effect": "catalog:effect",
    "@effect/ai-openai": "catalog:effect"
  },
  "peerDependencies": {
    "effect": "catalog:effectPeers",
    "@effect/ai-openai": "catalog:effectPeers"
  }
}
```

pnpm rewrites `catalog:` specifiers to concrete ranges when it publishes, so what lands on the registry is an ordinary manifest. Nothing downstream needs this plugin, or pnpm.

### Testing against both Effect versions

During the Effect v3 → v4 transition the plugin also ships an `effect3` catalog — and its `effect3Peers` floor — tracking the latest Effect **v3** releases, so you can verify code against both Effect majors in a single monorepo. A package or test workspace that should build against v3 references `catalog:effect3` where another references `catalog:effect`:

```json
{
  "devDependencies": {
    "effect": "catalog:effect3"
  }
}
```

A handful of packages are excluded where their v3 line has known issues. The `effect3` catalogs are removed at this plugin's own `1.0.0`, once Effect `4.0.0` has shipped and there is nothing left to interoperate with.

## What it ships

| Catalog | Contents | Use it in |
| ------- | -------- | --------- |
| `catalog:effect` | Every `effect` and `@effect/*` package, pinned to one v4 release | `dependencies` for applications, `devDependencies` for libraries |
| `catalog:effectPeers` | The same package set at the computed shared peer floor | `peerDependencies` for libraries |
| `catalog:effect3` | The same package set tracking the latest Effect **v3** releases, a few excluded | testing against Effect v3 alongside v4 |
| `catalog:effect3Peers` | The v3 package set at its computed peer floor | `peerDependencies` when advertising v3 support |

It also ships a pnpmfile, which pnpm loads from the config dependency automatically. There is nothing to import and nothing to call — the package has no code API, only configuration.

While the whole ecosystem is pinned to a single beta of Effect v4, the two catalogs largely coincide. The floor computation earns its keep once the packages' releases desynchronize — and it earned it under Effect v3, where the floors genuinely diverged.

## License

[MIT](LICENSE)
