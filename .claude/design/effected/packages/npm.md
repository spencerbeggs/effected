---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-07-12
last-synced: 2026-07-12
completeness: 90
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - package-json.md
  - workspaces.md
---

# @effected/npm design

## Overview

`@effected/npm` is a **new pure-tier package** (not a migration — there is no `npm-effect` source repo) spun out of the [@effected/package-json](package-json.md) port. It is the home for the **dependency-resolution contracts** that a package.json-document library defines but cannot implement: `CatalogResolver` and `WorkspaceResolver` (resolving pnpm `catalog:` / `workspace:` specifiers to concrete versions) and the `DependencyResolutionError` they raise.

Why it exists as its own package rather than living in package-json: resolution fundamentally requires workspace/catalog context that package-json cannot have, and the maintainer has downstream uses for these contracts beyond package-json queued (making the second consumer real, not speculative). The full rationale — and the alternatives weighed — is [resolution belongs to @effected/npm](package-json.md#resolution-belongs-to-effectednpm) in the package-json design.

**Scope discipline: minimal to start.** The initial surface is exactly what package-json's port needs — the two resolver contracts, their no-op default layers, and the shared error. It is **not** a general "npm/pnpm vocabulary" package yet: `DependencySpecifier` (the specifier taxonomy) and `PackageName` (npm naming) deliberately stay in [@effected/package-json](package-json.md) for now. `@effected/npm` was scoped to expand when `@effected/workspaces` landed — and when it did, **the contracts held without amendment**: workspaces implements both directly as layers over its own services (see [workspaces.md](workspaces.md#implementing-effectednpms-resolver-contracts)). Extracting the vocabulary concepts remains a later, evidence-driven decision.

Status: **merged** (landed alongside the package-json port). The verify-at-port-time notes below resolve to inline "As-built:" notes; the package shipped with all gates passing — tests, typecheck, biome and a zero-warning `dist/prod/issues.json`. The public surface is exactly `CatalogResolver`, `WorkspaceResolver`, `DependencyResolutionError` and the composite `Default` layer. (As-built (realignment, 2026-07-08): the transitional `@public X_base` consts are gone — the three factories are written inline with the synthesized `_base` symbols suppressed in `savvy.build.ts`; see [API Extractor bases](#api-extractor-bases-house-policy).)

## Tier and dependencies

**Pure tier.** The package contains only abstract service contracts (Context tags + shapes), pure no-op default layers, and one schema-backed error — **no IO, no recursion, no untrusted-input parsing.** A service *contract* is a type-level identity plus an interface shape; defining one runs no effect. The no-op default layers are `Layer.succeed` over pure functions returning `Option.none()`.

- `peerDependencies`: `effect` only (`catalog:effect`). Trivially complete closure — `effect` has no peers.
- `dependencies`: none. (No `@effected/semver` edge — the contracts traffic in plain `string` versions/ranges, not `SemVer`/`Range` instances; range *parsing* stays in package-json's `DependencySpecifier`.)
- `devDependencies`: `effect` and `@effect/vitest` (`catalog:effect`); `@types/node`, `typescript` (`catalog:silk`).
- Target directory: `packages/npm`. `"sideEffects": false`.

This is the cleanest possible profile: `effect`-only peers, zero regular dependencies, no workspace edges outbound. The dependency arrows point **at** it: `@effected/package-json` → `@effected/npm` (`workspace:*`), and later `@effected/workspaces` → `@effected/npm`.

## Module layout (module-per-concept)

~~~text
src/
  index.ts             # public surface, re-exports only
  CatalogResolver.ts   # Context.Service contract + no-op default layer
  WorkspaceResolver.ts # Context.Service contract + no-op default layer;
                       #   owns DependencyResolutionError (both resolvers raise it)
~~~

`DependencyResolutionError` is co-located in `WorkspaceResolver.ts` (or a shared leaf if a cleaner cycle-free home is wanted at port time) because both resolver contracts reference it in their error channel; keeping it beside the resolvers avoids a third file for one error. Both concept files import it explicitly — no barrel, no re-export facade.

As-built: `WorkspaceResolver.ts` owns `DependencyResolutionError`; `CatalogResolver.ts` **type-imports** it (a one-way runtime edge — CatalogResolver has no runtime dependency on WorkspaceResolver). The composite `Default` layer therefore does **not** live in `WorkspaceResolver.ts` — it lives in `index.ts` (`Default = Layer.mergeAll(CatalogResolver.noop, WorkspaceResolver.noop)`), the clean cycle-free home, because merging both no-op layers there needs both concept modules and `index.ts` already depends on both.

## Target API

As-built: the service contract form is `Context.Service<Self, Shape>()("@effected/npm/CatalogResolver")` — **type params first (self + shape), the string id last, no `make` option**. The `Shape` is inlined structurally at the call site rather than exported as a separate named interface. Both resolvers follow this identical idiom. As-built (realignment, 2026-07-08): the class is written inline with no `@public` base annotation — the former `Context.ServiceClass<Self, "id", Shape>` return-type annotation is gone and the synthesized `_base` symbol is suppressed in `savvy.build.ts`. No-op layers are `static readonly noop = Layer.succeed(Class, { ...impl })` bound to a const (memoized by reference).

### CatalogResolver

`Context.Service` contract resolving `catalog:` specifiers. Given a package name and an optional catalog name (`Option.none()` = the default catalog), returns the configured range, or `Option.none()` if it cannot be resolved.

- `rangeOf(packageName: string, catalog: Option<string>) → Effect<Option<string>, DependencyResolutionError>`
- **No-op default layer** (`CatalogResolver.noop`): `rangeOf` always succeeds with `Option.none()`. Pure `Layer.succeed`.

### WorkspaceResolver

`Context.Service` contract resolving `workspace:` specifiers. Given a workspace package name, returns its concrete version (without the range modifier), or `Option.none()` if it cannot be resolved.

- `versionOf(packageName: string) → Effect<Option<string>, DependencyResolutionError>`
- **No-op default layer**: `versionOf` always succeeds with `Option.none()`. Pure `Layer.succeed`.

### DependencyResolutionError

`Schema.TaggedErrorClass` (the [standards ladder](../effect-standards.md#error-handling-standards) default) with structured fields — `specifier: string` and a `cause: Schema.Defect()` (never a stringified message) — and a computed `get message()`. Serializable for free. Both resolver contracts fail with it.

As-built: the cause field is `Schema.Defect()` — **`Schema.Defect` is a callable in beta.93, not a bare schema value**; the bare form (`cause: Schema.Defect`) throws at construction time. Stub test layers build their `Option` results with `Option.fromUndefinedOr` — `Option.fromNullable` is gone in v4.

**A composite `Default` layer** merges both no-op resolvers so a consumer that just wants package-json's `Package.resolve` to type-check (resolving nothing) provides one layer. Layers are memoized by reference — bound to consts, never getters, per the [services standard](../effect-standards.md#services-and-layers-standards). As-built: `Default = Layer.mergeAll(CatalogResolver.noop, WorkspaceResolver.noop)` lives in `index.ts` (see the [module layout](#module-layout-module-per-concept) as-built note) to stay cycle-free.

## v4 API drift to verify early

- **`Context.Service` contract-only form** — the exact v4 spelling for a service that declares a *shape* with no baked-in default implementation (the layer is separate). Confirm the `Context.Service` class form and how the no-op layer is written against it (`Layer.succeed` with the interface object). This is the same idiom package-json's `PackageValidator` uses, so the two ports share the discovery. As-built: `Context.Service<Self, Shape>()("id")` with type params first and id last, written inline (the transitional `Context.ServiceClass<Self, "id", Shape>` base annotation was removed in the realignment — see [Target API](#target-api) as-built note); no-op layer `Layer.succeed(Class, { ...impl })`.
- **`Schema.TaggedErrorClass` with a `Schema.Defect` cause field** — already house-verified in semver/jsonc/yaml; reused here unchanged. As-built: `Schema.Defect` must be **called** (`Schema.Defect()`) in beta.93 — the bare value throws at construction.

## API Extractor bases (house policy)

Per the [ratified house policy](../effect-standards.md#api-extractor--effect-class-factories) and the `effect-api-extractor-bases` skill: the two `Context.Service` classes and the `Schema.TaggedErrorClass` are written inline (`export class X extends Context.Service<X, Shape>()("id") {}` / `Schema.TaggedErrorClass<X>()("X", {...})`), with the synthesized `_base` heritage symbols suppressed narrowly in `savvy.build.ts` (`ae-forgotten-export` / `_base` pattern). Small surface — three factory-backed classes — so a zero-warning `dist/prod/issues.json` (every `*_base` in the `suppressed` bucket) is straightforward.

The original port landed on the transitional `@public X_base` idiom; the realignment (2026-07-08) converted it to the inline form above alongside the other four packages, a mechanical narrowing that removed the exported base consts.

## Testing strategy

`@effect/vitest`, `it.effect`. The surface is contracts, so tests are light and focused:

- **No-op default layers**: `CatalogResolver.rangeOf` / `WorkspaceResolver.versionOf` return `Option.none()` under the default layer (provided via top-level `layer(...)` grouping, not per-test `Effect.provide`).
- **A stub-implementation layer** (a test double resolving a fixed map) proves the contract is implementable and that `rangeOf`/`versionOf` thread through correctly — the pattern real consumers (workspaces) will follow.
- **`DependencyResolutionError`**: structured `cause` preserved (not stringified), `message` getter renders, serializes/round-trips.

Tests live in `packages/npm/__test__/` per repo convention (`CatalogResolver`, `WorkspaceResolver`).

As-built: all tests green with a zero-warning `dist/prod/issues.json`. Stub-implementation test layers build their `Option` results with `Option.fromUndefinedOr` (`Option.fromNullable` is gone in v4).

## Future expansion (deferred, evidence-driven)

Recorded so the seam is explicit:

- **`@effected/workspaces` reconciliation — resolved.** Workspaces implements both contracts directly as layers over its own services (`WorkspaceCatalogs.catalogResolver`, `WorkspaceDiscovery.workspaceResolver`), and the contracts' unmatched-name-is-`None` convention held without amendment. See [workspaces.md](workspaces.md#implementing-effectednpms-resolver-contracts).
- **Vocabulary tenants** — `DependencySpecifier` and `PackageName` are the natural next residents if a second consumer beyond package-json materializes for them; they stay in package-json until then.
- **The pnpm `catalogs:` record shape** — the workspaces review routes this toward `@effected/lockfiles`, not here; do not pre-claim it.
