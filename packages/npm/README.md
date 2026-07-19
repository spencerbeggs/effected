# @effected/npm

[![npm](https://img.shields.io/npm/v/@effected%2Fnpm?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/npm)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Effect service contracts for resolving pnpm `catalog:` and `workspace:` dependency specifiers. `CatalogResolver.rangeOf` turns a package name plus an optional catalog name into the configured range; `WorkspaceResolver.versionOf` turns a workspace package name into its concrete version. Both are `Context.Service` contracts, both ship a no-op default layer that resolves nothing, and neither one reads a file. The package is the seam: a library that needs to *expand* a specifier depends on this, and something that can actually see the workspace supplies the implementation. On top of the contracts sit the kit's shared dependency vocabulary — `DependencySpecifier`, `DependencySection`, `IntegrityHash` — and `Manifest`, a tolerant manifest model that resolves every `catalog:` and `workspace:` specifier through the contracts in one call.

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

## Why @effected/npm

`catalog:` and `workspace:` are specifiers whose meaning lives somewhere other than the manifest they appear in. A package.json document library can parse `"effect": "catalog:"` perfectly well and still have no way to say what it resolves to, because the answer is in a workspace file it has no business reading. The usual escape hatches are both bad: take a dependency on a workspace crawler and drag a filesystem into a pure document library, or accept a resolver as an untyped callback and lose the failure channel. Neither is a contract. This package is the contract — shape only, so `@effected/package-json` can express `Package.resolve` against services in `R` and let the application decide where resolution actually comes from.

The one design decision worth stating up front: **an unmatched specifier is `Option.none()`, not an error**. A package that is absent from a catalog, or a name that is not a workspace member, is an ordinary answer and the resolver succeeds with `None`. The error channel is reserved for the resolution *mechanism* failing — an unreadable catalog file, a malformed workspace manifest — and `DependencyResolutionError` carries that cause structurally on a `Schema.Defect` field rather than folding it into a string. Blurring those two is how "no such package" ends up indistinguishable from "your disk is on fire".

## Install

```bash
npm install @effected/npm effect
```

```bash
pnpm add @effected/npm effect
```

Requires Node.js >=24.11.0.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

`effect` v4 is the only peer dependency and the only dependency of any kind. Defining a contract runs no effect and touches no filesystem: the default layers are `Layer.succeed` over functions that return `Option.none()`.

## Quick start

The `Default` layer merges both no-op resolvers. Provide it when the contracts need to be satisfied but nothing should be resolved:

```ts
import { CatalogResolver, Default, WorkspaceResolver } from "@effected/npm";
import { Effect, Option } from "effect";

const program = Effect.gen(function* () {
  const catalog = yield* CatalogResolver;
  const workspace = yield* WorkspaceResolver;
  return yield* Effect.all([
    catalog.rangeOf("effect", Option.none()),
    workspace.versionOf("@effected/semver"),
  ]);
});

Effect.runPromise(Effect.provide(program, Default)).then(console.log);
// => [Option.none(), Option.none()]
```

`Option.none()` for the `catalog` argument selects the default catalog; `Option.some("build")` selects the named one.

## The contracts

| Service | Method | Returns |
| ------- | ------ | ------- |
| `CatalogResolver` | `rangeOf(packageName, catalog: Option<string>)` | `Option<string>` — the configured range, or `None` when the package is not in that catalog |
| `WorkspaceResolver` | `versionOf(packageName)` | `Option<string>` — the concrete version with the range modifier stripped, or `None` when the name is not a workspace member |

Both fail with `DependencyResolutionError`, which carries the `specifier` that could not be resolved and the structured `cause` of the underlying failure; `rangeOf` can additionally fail with `CatalogAssemblyError` when the catalogs could not be assembled from their sources. Both ship a `noop` layer bound to a const, so it memoizes by reference rather than minting a fresh layer at every use.

## Implementing a resolver

A real resolver is a `Layer.succeed` over the shape. `@effected/workspaces` implements these against a discovered monorepo, but the contract is small enough that a fixed record is a legitimate implementation — for a test, a fixture, or a tool that already knows its own catalog:

```ts
import { CatalogResolver, WorkspaceResolver } from "@effected/npm";
import { Effect, Layer, Option } from "effect";

const catalogs: Record<string, Record<string, string>> = {
  default: { effect: "^4.0.0" },
  build: { typescript: "^6.0.0" },
};

const workspaceVersions: Record<string, string> = { "@acme/widget": "1.4.0" };

export const ResolversLive = Layer.mergeAll(
  Layer.succeed(CatalogResolver, {
    rangeOf: (packageName, catalog) =>
      Effect.succeed(Option.fromUndefinedOr(catalogs[Option.getOrElse(catalog, () => "default")]?.[packageName])),
  }),
  Layer.succeed(WorkspaceResolver, {
    versionOf: (packageName) => Effect.succeed(Option.fromUndefinedOr(workspaceVersions[packageName])),
  }),
);
```

Note what the implementation does *not* do: an unknown package name returns `Option.none()` and never fails. Save the error channel for the case where you tried to read the catalog and could not.

## Manifest-level resolution

`Manifest` is a tolerant manifest model over the contracts: the four dependency fields are typed as string→string records, and every other top-level field rides through a `rest` catch-all that flattens back on encode, so the wire shape never carries a literal `rest` key. It is deliberately not `@effected/package-json`'s strict `Package` — a mid-build manifest is an arbitrary user record, and resolution has no business validating fields it never reads.

```ts
import { Default, Manifest } from "@effected/npm";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const manifest = yield* Manifest.decode({ name: "app", dependencies: { effect: "^4.0.0" } });
  const resolved = manifest.needsResolution ? yield* manifest.resolve() : manifest;
  return resolved.toRecord();
});

Effect.runPromise(Effect.provide(program, Default)).then(console.log);
// => { dependencies: { effect: "^4.0.0" }, name: "app" }
```

`needsResolution` is a pure getter: check it first and skip resolution entirely (and whatever catalog assembly backs the resolvers) when no dependency field carries a `catalog:` or `workspace:` specifier. `resolve()` projects every such specifier through the contracts and returns a new `Manifest`, applying pnpm's publish-time semantics — the alias form `workspace:<name>@<range>` resolves the *target* package's version and becomes the `npm:<name>@<range>` alias pnpm publishes. At the manifest level a specifier the resolvers answer `Option.none()` for fails typed as `UnresolvedDependencyError`, naming the field, the dependency and the reason: an unmatched entry is an ordinary answer for a resolver, but it means the manifest cannot be projected.

## Who consumes this

`@effected/package-json` is the reason the package exists. `Package.resolve` walks all four dependency maps, expands every `catalog:` and `workspace:` specifier through these two services, and leaves untouched any specifier the resolvers answered `None` for. `@effected/lockfiles` came second, which is why the specifier and integrity vocabulary lives here rather than in package-json. `@effected/workspaces` sits on the other side of the seam and provides the implementations that read a real pnpm workspace — its `Workspaces.resolveManifest` runs `Manifest.resolve()` for you over a freshly discovered workspace. Nothing in this package points outward at any of them.

## Features

- `CatalogResolver` — the `catalog:` contract, plus `CatalogResolver.noop`.
- `WorkspaceResolver` — the `workspace:` contract, plus `WorkspaceResolver.noop`.
- `DependencyResolutionError` / `CatalogAssemblyError` — the typed failures: the resolution mechanism broke, or the catalogs could not be assembled from their sources.
- `Default` — `Layer.mergeAll` of the two no-op layers, for when the types need satisfying and nothing needs resolving.
- `Manifest` — the tolerant manifest model: `Manifest.decode`, the pure `needsResolution` fast path, `resolve()` over the contracts and `toRecord()` back to the wire shape, with `ManifestDecodeError` and `UnresolvedDependencyError` as its typed failures.
- `DependencySpecifier` — the specifier taxonomy: an eleven-protocol classifier, a codec decoding any specifier into a matchable tagged union that encodes back byte-for-byte, and the resolution statics (`catalogNameOf`, `resolveWorkspace`, `workspaceTargetOf`) implementing pnpm's publish-time projection.
- `DependencySection` — the kit-wide dependency vocabulary: `DependencyKind`, `DependencyField` and the mapping between them.
- `IntegrityHash` — a brand over the three textual integrity forms (SRI, corepack, yarn), with `algorithmOf`.

The surface grows when a consumer proves it needs more, not before.

## License

[MIT](LICENSE)
