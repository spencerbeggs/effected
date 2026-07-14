---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-07-14
last-synced: 2026-07-12
completeness: 90
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - package-json.md
  - workspaces.md
  - lockfiles.md
---

# @effected/npm design

## Overview

`@effected/npm` is a **new pure-tier package** (not a migration — there is no `npm-effect` source repo) spun out of the [@effected/package-json](package-json.md) port. It is the home for the **dependency-resolution contracts** that a package.json-document library defines but cannot implement: `CatalogResolver` and `WorkspaceResolver` (resolving pnpm `catalog:` / `workspace:` specifiers to concrete versions) and the `DependencyResolutionError` they raise.

Why it exists as its own package rather than living in package-json: resolution fundamentally requires workspace/catalog context that package-json cannot have, and the maintainer has downstream uses for these contracts beyond package-json queued (making the second consumer real, not speculative). The full rationale — and the alternatives weighed — is [resolution belongs to @effected/npm](package-json.md#resolution-belongs-to-effectednpm) in the package-json design.

**Scope discipline: minimal to start.** The initial surface is exactly what package-json's port needs — the two resolver contracts, their no-op default layers, and the shared error. It is **not** a general "npm/pnpm vocabulary" package yet: `DependencySpecifier` (the specifier taxonomy) and `PackageName` (npm naming) deliberately stay in [@effected/package-json](package-json.md) for now. `@effected/npm` was scoped to expand when `@effected/workspaces` landed — and when it did, **the contracts held without amendment**: workspaces implements both directly as layers over its own services (see [workspaces.md](workspaces.md#implementing-effectednpms-resolver-contracts)). Extracting the vocabulary concepts remains a later, evidence-driven decision — and for `DependencySpecifier`, the evidence arrived: see [the v2 expansion](#dependencyspecifier-v2-expansion-designed-2026-07-14).

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

## DependencySpecifier (v2 expansion, designed 2026-07-14)

The vocabulary trigger fired: the [lockfiles importers design](lockfiles.md#importers-v2-addition-designed-2026-07-14) is the second consumer (`ImporterDependency.specifier`), and the [workspaces snapshots design](workspaces.md#v2-additions-designed-2026-07-14) is a third (`WorkspaceStateSnapshot.resolve` and the snapshot-scoped resolver layers). **`DependencySpecifier` moves here.** One specifier grammar then spans the kit — lockfiles, workspaces and package-json all classify a specifier the same way, instead of three prefix-sniffing reimplementations. Design-first; exact spellings are settled at the effect-v4-planning gate at implementation time.

This is a **relocation, not a green-field design**: package-json already ships an as-built `DependencySpecifier` — a brand plus taxonomy statics whose `protocolOf` classifies eleven protocols (`range | tag | git | url | npm | file | link | portal | catalog | workspace | unknown`; see [package-json.md](package-json.md#dependencyspecifier)). That taxonomy moves here intact, and package-json imports it back (the pure edge already exists via `DependencyResolutionError`). The tagged-union DX below layers on top of it; how the brand-plus-statics form and the union form reconcile — one schema with derived predicates, or a union decoded from the brand — is settled at the effect-v4-planning gate. The union's cases deliberately group the protocols the *resolvers* distinguish; the finer eleven-way classification survives as the statics.

The shape is a tagged union over what a manifest or lockfile can declare:

- **catalog** — a `catalog:` reference, distinguishing the default catalog from a named one.
- **workspace** — a `workspace:` reference, carrying its range or alias form.
- **range** — a plain semver range. The case carries the raw string; whether it additionally validates through `@effected/semver` (a legal pure-to-pure edge, but not pre-claimed) is an implementation-gate decision.
- **dist-tag** — a bare tag (`latest`, `next`).
- **raw** — the honest fallback for `file:` / `link:` / git / URL forms this package does not further interpret.

It ships with a `FromString` codec (the house `FromString` static pattern), and the codec's contract is the **exact-string round-trip guarantee**: decoding classifies, encoding returns the original specifier string byte-for-byte. That guarantee is what lets brownfield consumers (silk-update-action's lockfile diffing, systems' `DepsRegen`) reimplement their v3 logic on the new model without ever losing the raw specifier. An `it.effect.prop` round-trip suite states it as a property.

What does **not** change: the resolver contracts and their unmatched-specifier-is-`Option.none()` convention are untouched; `DependencyResolutionError` remains reserved for mechanism failure. `PackageName` **stays in package-json** — a brand with one consumer has no reason to move. The export count grows beyond the original four; this section is the documented evidence-driven expansion the scope-discipline paragraph promised.

## Two more scalars move in (designed 2026-07-14)

The same round consolidates two further pieces of vocabulary whose duplication is measured, not predicted — surveyed across the installed packages on 2026-07-14:

- **The dependency-section vocabulary.** One concept, three spellings today: lockfiles exports `DependencyType` (the four manifest field names, `WorkspaceDependency.ts`), package-json has `DependencyKind` (`"prod" | "dev" | "peer" | "optional"`, `Dependency.ts`), and workspaces hand-rolls the four field names across `WorkspacePackage` and `DependencyDiff` — with the [lockfiles importers design](lockfiles.md#importers-v2-addition-designed-2026-07-14) about to add a fourth use. This package becomes the owner: one schema carrying both views — the manifest **field names** (`dependencies` … `optionalDependencies`) and the short **kinds** (`prod` … `optional`) — with the bidirectional mapping written once. lockfiles' `DependencyType` relocates here (the same free-before-`0.1.0` logic as `DependencySpecifier`); package-json's `Dependency.kind` types against it; workspaces consumes it. Exact spellings settle at the effect-v4-planning gate.
- **`IntegrityHash`.** The same SRI idea is a plain string twice today: lockfiles' `ResolvedPackage.integrity` (`sha512-` base64 SRI, also what package-lock records) and package-json's `PackageManager.integrity` (the `name@version+sha512.hex` pin form). A brand covering both textual forms, with parse/validation, lands here; both consumers re-point. Exact grammar (which algorithms, both delimiters) settles at implementation.

Both moves are pure-to-pure edges that already exist or arrive with this workstream; no tier changes anywhere.

## Vocabulary registry (npm v12 parity map, recorded 2026-07-14)

The kit has hit the shared-vocabulary seam repeatedly — `DependencySpecifier`, the dependency-section vocabulary, `IntegrityHash` — because four packages (npm, package-json, lockfiles, workspaces) operate around overlapping npm concepts without a recorded map of where each concept lives. This registry is that map, surveyed against the npm v12 documentation for [`package.json`](https://docs.npmjs.com/cli/v12/configuring-npm/package-json) and [`package-lock.json`](https://docs.npmjs.com/cli/v12/configuring-npm/package-lock-json). The rule is unchanged — **API ships on evidence, the registry ships the map**: an unmodeled concept stays unmodeled until a consumer materializes, but nobody rebuilds an idiom because they did not know its home.

Standing assignments: versions and ranges → `@effected/semver`; manifest shapes → `@effected/package-json`; lockfile shapes → `@effected/lockfiles`; workspace/monorepo semantics → `@effected/workspaces`; cross-cutting scalars that flow between those concerns → **here**.

### package.json (npm v12)

| Field | Status | Home / notes |
| --- | --- | --- |
| `name` | modeled | package-json `PackageName` (brand + statics) |
| `version` | modeled | package-json via `@effected/semver` `SemVer.FromString` |
| `description`, `private`, `type`, `main` | modeled | package-json `Package` first-class fields |
| `license` | modeled | package-json `SpdxLicense` (real SPDX validation) |
| `author` / `contributors` | modeled | package-json `Person.FromValue` (string and object forms) |
| `repository` | modeled | package-json `RepositoryField` |
| `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies` | modeled | package-json `DependencyMapField`; specifiers classify via `DependencySpecifier` (here); section vocabulary consolidates here (above) |
| `peerDependenciesMeta` | modeled | package-json `PeerDependenciesMetaField` |
| `scripts` | modeled | package-json (string map) |
| `bin` | modeled | package-json `BinField` |
| `engines` | modeled | package-json (string map) |
| `exports` | modeled | package-json `ExportsField` |
| `publishConfig` | modeled **twice, deliberately** | package-json `PublishConfigField` and workspaces `PublishConfig` — an accepted duplication: `WorkspacePackage` is deliberately tolerant and takes no package-json edge (recorded in workspaces' design). Revisit only if the tolerance decision itself is revisited |
| `packageManager` | modeled | package-json `PackageManager` (`name@version+integrity` codec); integrity half re-points to `IntegrityHash` (above) |
| `devEngines` | modeled | package-json `DevEnginesSchema`; workspaces separately *reads* the field as a detection hint (`PackageManagerName.ts`) without modeling it — reading, not a second model |
| `workspaces` | read, not modeled | workspaces reads globs (`internal/patterns.ts`) and — per [the v2 design](workspaces.md#v2-additions-designed-2026-07-14) — bun-style `catalog`/`catalogs`; package-json preserves the field via `rest`. Trigger for modeling: a consumer needing to *write* the field |
| `keywords`, `homepage`, `bugs`, `funding` | preserved, not modeled | package-json `rest` (round-trips untouched). Trigger: a consumer that reads or validates them |
| `files`, `browser`, `man`, `directories` | preserved, not modeled | package-json `rest`. Simple text stays simple text (`files` is an array of globs — a consumer wanting *matching* would route through `@effected/glob`) |
| `config`, `gypfile` | preserved, not modeled | package-json `rest`. No plausible kit consumer |
| `bundleDependencies` | preserved, not modeled | package-json `rest`. Trigger: pack/publish tooling |
| `overrides`, `packageExtensions` | preserved, not modeled | package-json `rest`. The repo *uses* pnpm `overrides` operationally (root workspace file), but no package models the field. Trigger: dependency-rewrite tooling |
| `os`, `cpu`, `libc` | preserved, not modeled | package-json `rest`. Trigger: install-planning tooling |

### package-lock.json (npm v12)

The lockfiles npm parser normalizes `package-lock.json` into the one `Lockfile` model rather than modeling the format field-for-field; this table records what survives normalization and what is deliberately discarded.

| Concept | Status | Home / notes |
| --- | --- | --- |
| `lockfileVersion` | kept | `Lockfile.lockfileVersion` (string-normalized) |
| `packages` map (v2/v3) | parsed | the entry source for `ResolvedPackage`; root `""` and workspace-path entries → workspace packages, `node_modules/*` → resolved packages |
| legacy v1 `dependencies` section | not parsed | the parser requires the `packages` map; a v1-only lockfile fails typed. Trigger: none expected — npm v5/v6 is out of scope |
| entry `version` | kept | `ResolvedPackage.version` |
| entry `integrity` | kept | `ResolvedPackage.integrity` — re-points to `IntegrityHash` (above) |
| entry `dependencies` / `optionalDependencies` | kept | workspace-entry sections feed `WorkspaceDependency` edges and — per [the importers design](lockfiles.md#importers-v2-addition-designed-2026-07-14) — `Lockfile.importers` |
| root/workspace declared deps | kept (new) | `Lockfile.importers` (`LockfileImporter` / `ImporterDependency`), the c594ff1 port |
| entry `resolved` (registry/git/link URL) | discarded | Trigger: provenance tooling (audit, mirror verification) |
| entry `link`, `dev`, `optional`, `devOptional`, `inBundle` | discarded | tree-membership flags. Trigger: a consumer reasoning about install trees rather than declared graphs |
| entry `hasInstallScript` | discarded | Trigger: a security/audit consumer — plausible, none declared |
| entry `bin`, `license`, `engines`, `os`, `cpu`, `funding` | discarded | manifest mirrors; the manifest is the source of truth and package-json models it |
| hidden lockfile (`node_modules/.package-lock.json`) | out of scope | a performance artifact of npm itself, same v3 format; `Lockfile.parse` takes content and does not care where it came from |

## Future expansion (deferred, evidence-driven)

Recorded so the seam is explicit:

- **`@effected/workspaces` reconciliation — resolved.** Workspaces implements both contracts directly as layers over its own services (`WorkspaceCatalogs.catalogResolver`, `WorkspaceDiscovery.workspaceResolver`), and the contracts' unmatched-name-is-`None` convention held without amendment. See [workspaces.md](workspaces.md#implementing-effectednpms-resolver-contracts).
- **Vocabulary tenants — partly resolved.** `DependencySpecifier` moved here when its second consumer materialized (see [the v2 expansion](#dependencyspecifier-v2-expansion-designed-2026-07-14)); `PackageName` stays in package-json until a second consumer for the brand exists.
- **The pnpm `catalogs:` record shape** — the workspaces review routes this toward `@effected/lockfiles`, not here; do not pre-claim it.
